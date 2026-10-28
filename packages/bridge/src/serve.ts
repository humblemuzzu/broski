import packageMeta from "../package.json";
import type { CliOptions } from "./cli";
import type { BroskiConfig } from "./config";
import { OpenCodeConnector } from "./connectors/opencode";
import { warmPiSessionIndex } from "./connectors/pi/pi-session-list-indexed";
import { bindWithRetry, isAddressInUse } from "./lifecycle/port-retry";
import { logDaemon, logDaemonError, setDaemonLogger } from "./logging/daemon-log";
import { createBridgeLogger } from "./logging/logger";
import { getKillPortHint, getProcessOnPort, IS_WINDOWS } from "./platform";
import { applyServiceShellEnv } from "./platform/shell-env";
import { loadOpenCodeSdk } from "./sdk/opencode-sdk";
import {
	bootstrapManagedOpenCode,
	bootstrapManualOpenCode,
	isOpencodeCliAvailable,
	type OpencodeBootstrap,
} from "./serve/open-code";
import { installProcessHandlers } from "./serve/process-handlers";
import { restartManagedOpenCode, shutdown, startOpenCodeHealthMonitor } from "./serve/shutdown";
import { serveState, subscribeOpenCodeStream } from "./serve/state";
import { createBridgeServer, loadOrCreateAuthState } from "./server";
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

async function bootstrapOpenCode(cli: CliOptions): Promise<OpencodeBootstrap | null> {
	try {
		if (cli.opencodeMode === "manual") {
			if (!cli.opencodeUrl) {
				logDaemon("Manual OpenCode mode requested but no --opencode-url/OPENCODE_BASE_URL provided.");
				logDaemon("Continuing without OpenCode (Claude Code / Codex still work).");
				return null;
			}
			return await bootstrapManualOpenCode(cli.opencodeUrl);
		}
		if (!isOpencodeCliAvailable(cli.verbose)) {
			logDaemon("OpenCode CLI not found in PATH; skipping OpenCode bootstrap.");
			return null;
		}
		return await bootstrapManagedOpenCode(cli.opencodeHostname, cli.opencodePort, cli.verbose);
	} catch (err) {
		logDaemon("⚠️  OpenCode not available; continuing without it.");
		if (cli.verbose) {
			logDaemonError(String(err));
		}
		return null;
	}
}

async function bindBridgeServer(
	cli: CliOptions,
	effectivePort: number,
	opencode: { pending: boolean; reason?: string },
	logger: ReturnType<typeof createBridgeLogger>,
	daemonLog: (message: string) => void,
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
					opencode: null,
					opencodePending: opencode.pending,
					opencodeReason: opencode.reason,
					version: packageMeta.version ?? "0.1.0",
					auth,
					linkSocket: cli.linkSocket,
					linkKeyFile: cli.linkKeyFile,
					restartOpenCode: restartManagedOpenCode,
					bridgeLogger: logger,
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
		if (serveState.opencodeServer && "close" in serveState.opencodeServer) {
			await serveState.opencodeServer.close().catch(() => undefined);
		}
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
	serveState.managedHostname = cli.opencodeHostname;
	serveState.managedPort = cli.opencodePort;

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

	// A managed OpenCode start takes about ten seconds. The listeners do not wait for it: the
	// start runs beside them, and the requests that need the backend wait for `setOpenCode`.
	const opencodeStart = startOpenCode(cli);
	serveState.opencodeServer = null;
	serveState.opencodeConnector = null;

	daemonLog("[daemon] Loading auth token...");
	daemonLog("[daemon] Creating bridge server...");
	await bindBridgeServer(cli, effectivePort, { pending: true }, bridgeLogger, daemonLog);
	const bridgeServer = serveState.bridgeServer;
	if (!bridgeServer) return;
	const bridgePort = bridgeServer.port();
	daemonLog(`[daemon] Bridge listening on 127.0.0.1:${bridgePort}; OpenCode is coming up alongside it`);

	const opencode = await settleOpenCode(opencodeStart, bridgeServer, daemonLog);

	if (opencode) {
		serveState.primaryEventStreamController = await subscribeOpenCodeStream(opencode, "primary", cli.verbose);
	}

	startOpenCodeHealthMonitor();

	daemonLog(`[daemon] Bridge listening on port ${bridgePort}`);

	// Warm the Pi session index in the background, so the first listing a phone asks for is served
	// from disk instead of scanning every session file.
	void warmPiSessionIndex();
	if (!cli.daemon) {
		logDaemon(`\n✓ Bridge listening on port ${bridgePort}`);
		logDaemon("  Pair your phone: broski-link pair");
		logDaemon("  Press Ctrl+C to shutdown");
		if (!serveState.opencodeServer) {
			logDaemon("  (OpenCode not detected - OpenCode-only features are unavailable)");
		} else if ("close" in serveState.opencodeServer) {
			logDaemon("  (OpenCode is managed by the bridge and will stop on shutdown)");
		} else {
			logDaemon("  (OpenCode is external and will be left running)");
		}
	}

	startupUpdateCheck(version, (msg) => logDaemon(msg))
		.then(async (result) => {
			if (!result?.updateAvailable) return;
			const ocRunning = await isOpenCodeRunning();
			bridgeServer.broadcast({
				type: "status",
				data: {
					opencodeRunning: ocRunning,
					updateAvailable: true,
					latestVersion: result.latestVersion,
					currentVersion: result.currentVersion,
				},
			});
		})
		.catch(() => {
			/* best-effort */
		});

	if (cli.daemon) {
		startPeriodicUpdateCheck(
			version,
			(result) => {
				logDaemon(`[update] Bridge v${result.latestVersion} available (current: v${result.currentVersion})`);
				void (async () => {
					serveState.bridgeServer?.broadcast({
						type: "status",
						data: {
							opencodeRunning: await isOpenCodeRunning(),
							updateAvailable: true,
							latestVersion: result.latestVersion,
							currentVersion: result.currentVersion,
						},
					});
				})();
			},
			(msg) => logDaemon(msg),
		);
	}
}

type OpenCodeStart = { bootstrap: OpencodeBootstrap | null; reason?: string };

/** Kicks off the OpenCode bootstrap without waiting for it. */
function startOpenCode(cli: CliOptions): Promise<OpenCodeStart> {
	return bootstrapOpenCode(cli).then(
		(bootstrap) => ({ bootstrap }),
		(error: unknown) => ({ bootstrap: null, reason: describeStartFailure(error) }),
	);
}

/** Hands the backend to the bridge, or the reason it never arrived. */
async function settleOpenCode(
	start: Promise<OpenCodeStart>,
	bridgeServer: NonNullable<typeof serveState.bridgeServer>,
	daemonLog: (message: string) => void,
): Promise<OpenCodeConnector | null> {
	const { bootstrap, reason } = await start;
	if (!bootstrap) {
		bridgeServer.setOpenCode(null, reason);
		daemonLog(`[daemon] OpenCode unavailable: ${reason ?? "it is not installed"}`);
		return null;
	}
	try {
		await loadOpenCodeSdk();
	} catch (error) {
		const failed = describeStartFailure(error);
		bridgeServer.setOpenCode(null, failed);
		daemonLog(`[daemon] OpenCode unavailable: ${failed}`);
		return null;
	}
	serveState.opencodeServer = bootstrap.server;
	const connector = new OpenCodeConnector({ baseUrl: bootstrap.server.url, client: bootstrap.client });
	serveState.opencodeConnector = connector;
	bridgeServer.setOpenCode(connector);
	daemonLog("[daemon] OpenCode is up");
	return connector;
}

function describeStartFailure(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim() || "the start failed";
}

async function isOpenCodeRunning(): Promise<boolean> {
	const connector = serveState.opencodeConnector;
	if (!connector) return false;
	return connector.isRunning().catch(() => false);
}
