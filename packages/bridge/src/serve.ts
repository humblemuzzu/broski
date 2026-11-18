import packageMeta from "../package.json";
import type { CliOptions } from "./cli";
import type { BroskiConfig } from "./config";
import { bindWithRetry, isAddressInUse } from "./lifecycle/port-retry";
import { logDaemon, setDaemonLogger } from "./logging/daemon-log";
import { createBridgeLogger } from "./logging/logger";
import { getKillPortHint, getProcessOnPort, IS_WINDOWS } from "./platform";
import { applyServiceShellEnv } from "./platform/shell-env";
import { installProcessHandlers } from "./serve/process-handlers";
import { shutdown } from "./serve/shutdown";
import { serveState } from "./serve/state";
import { createBridgeServer, loadOrCreateAuthState } from "./server";
import { defaultClaudeCliEnvironment, resolveClaudeCliPath } from "./server/claude-cli-path";
import { type ClaudeCodeWiring, createClaudeCodeWiring } from "./server/claude-code-wiring";
import { contractOptions } from "./server/contract-backends";
import { phoneWriting } from "./server/phone-writing";
import { startPeriodicUpdateCheck, startupUpdateCheck } from "./updater";

async function runFirstRunWizard(cli: CliOptions): Promise<void> {
	if (cli.skipWizard || cli.daemon) return;

	const { readConfig } = await import("./config");
	const { getConfigPath } = await import("./config/read-write");
	const { existsSync } = await import("node:fs");
	const config = await readConfig();
	if (config.wizard.completedSetup) return;

	const configPath = getConfigPath();
	if (existsSync(configPath)) return;

	logDaemon("\nFirst time? Let's get you set up!\n");
	try {
		const { ClackPrompter } = await import("./wizard");
		const { runOnboardingWizard } = await import("./wizard/onboarding");
		const clack = await import("@clack/prompts");
		const shouldRun = await clack.confirm({
			message: "Run the setup wizard?",
			initialValue: true,
		});
		if (shouldRun && !clack.isCancel(shouldRun)) {
			const prompter = new ClackPrompter();
			await runOnboardingWizard(prompter);
		}
	} catch {
		// Wizard cancelled or error, continue to serve
	}
}

async function bindBridgeServer(
	cli: CliOptions,
	effectivePort: number,
	logger: ReturnType<typeof createBridgeLogger>,
	daemonLog: (message: string) => void,
	claudeCode: ClaudeCodeWiring,
): Promise<void> {
	const auth = await loadOrCreateAuthState(cli.newToken);
	if (cli.newToken) {
		logDaemon("✓ New auth token generated");
	} else {
		logDaemon("✓ Auth token loaded (persistent across restarts)");
	}

	try {
		serveState.bridgeServer = await bindWithRetry(
			() =>
				createBridgeServer({
					port: effectivePort,
					version: packageMeta.version ?? "0.1.0",
					auth,
					linkSocket: cli.linkSocket,
					linkKeyFile: cli.linkKeyFile,
					bridgeLogger: logger,
					contract: contractOptions(claudeCode),
					claudeCode,
				}),
			{
				mode: cli.daemon ? "daemon" : "once",
				onRetry: (info) =>
					daemonLog(
						`[daemon] Port ${effectivePort} still in use (attempt ${info.attempt}) — retrying in ${Math.round(info.delayMs / 1000)}s`,
					),
			},
		);
	} catch (error: unknown) {
		reportBindFailure(error, effectivePort, logger);
		process.exit(1);
	}
}

function reportBindFailure(error: unknown, effectivePort: number, logger: ReturnType<typeof createBridgeLogger>): void {
	if (!isAddressInUse(error)) {
		logger.error(`\n❌ Failed to start bridge server: ${error}`);
		return;
	}

	logger.error(`\n❌ Bridge port ${effectivePort} is already in use.`);
	logger.error("This usually means another broski process is still running.");
	logger.error("If you stopped it with Ctrl+Z, it was suspended (not terminated) and will keep the port open.");
	logger.error("Fix options:");
	logger.error("  - If it is a suspended job: return to that terminal, run `fg`, then press Ctrl+C.");
	logger.error("  - Or find and stop the process holding the port:");
	logger.error(`      ${getKillPortHint(effectivePort)}`);
	logger.error("  - Dev fallback: run the bridge on a different port: --port 0 (random free port)\n");

	void getProcessOnPort(effectivePort).then((proc) => {
		if (!proc) return;
		logger.error(`Port owner: ${proc.name} (PID ${proc.pid})`);
		logger.error("");
	});
}

export async function runServe(cli: CliOptions, config: BroskiConfig): Promise<void> {
	const argvHas = (flag: string): boolean => process.argv.includes(flag);
	const argvHasPortFlag = argvHas("--port") || argvHas("--bridge-port");

	installProcessHandlers(shutdown, process, IS_WINDOWS);
	serveState.verboseMode = cli.verbose;

	// Create leveled logger — binary users see only important events;
	// dev mode shows everything; all levels always go to the log file.
	const bridgeLogger = createBridgeLogger({ verbose: cli.verbose });
	serveState.activeBridgeLogger = bridgeLogger;
	setDaemonLogger(bridgeLogger);

	const daemonLog = (message: string): void => {
		if (cli.daemon) bridgeLogger.user(message);
	};

	await runFirstRunWizard(cli);

	const version = packageMeta.version ?? "0.1.0";

	const effectivePort =
		!argvHasPortFlag && !process.env.BROSKI_PORT && config.network.port ? config.network.port : cli.bridgePort;

	await applyServiceShellEnv(
		{ info: bridgeLogger.info, warn: bridgeLogger.user },
		{ daemon: cli.daemon, linkSocket: cli.linkSocket },
	);

	const claudeCode = createClaudeCodeWiring({
		settings: config.claudeCode,
		cli: () => resolveClaudeCliPath(defaultClaudeCliEnvironment(config.claudeCode.cliPath)),
		version,
		log: bridgeLogger.info,
		appendSystemPrompt: phoneWriting(config.phoneWriting),
	});

	daemonLog("[daemon] Loading auth token...");
	daemonLog("[daemon] Creating bridge server...");
	await bindBridgeServer(cli, effectivePort, bridgeLogger, daemonLog, claudeCode);
	const bridgeServer = serveState.bridgeServer;
	if (!bridgeServer) return;
	const bridgePort = bridgeServer.port();
	daemonLog(`[daemon] Bridge listening on port ${bridgePort}`);

	if (!cli.daemon) {
		logDaemon(`\n✓ Bridge listening on port ${bridgePort}`);
		logDaemon("  Pair your phone: broski-link pair");
		logDaemon("  Press Ctrl+C to shutdown");
	}

	void startupUpdateCheck(version, (msg) => logDaemon(msg));

	if (cli.daemon) {
		startPeriodicUpdateCheck(
			version,
			(result) => logDaemon(`[update] Bridge v${result.latestVersion} available (current: v${result.currentVersion})`),
			(msg) => logDaemon(msg),
		);
	}
}
