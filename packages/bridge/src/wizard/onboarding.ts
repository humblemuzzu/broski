import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { type BroskiConfig, getConfigPath, readConfig, writeConfig } from "../config";
import { getDefaultConfig } from "../config/defaults";
import {
	type DaemonConfig,
	type DaemonType,
	getBroskiBinaryPath,
	getDaemonType,
	IS_MACOS,
	installDaemon,
} from "../platform";
import { WizardCancelledError } from "./errors";
import { brand, muted, warning } from "./palette";
import type { WizardPrompter } from "./prompter";
import { setupConfig } from "./setup-config";
import { detectAgents, runAgentsStep } from "./steps/agents";
import { runDaemonStep } from "./steps/daemon";
import { runFinalizeStep } from "./steps/finalize";
import { runSecurityStep } from "./steps/security";
import { runWelcomeStep } from "./steps/welcome";

export interface OnboardingOptions {
	quick?: boolean;
	advanced?: boolean;
	nonInteractive?: boolean;
	// Non-interactive flag overrides
	agents?: string[];
	tls?: boolean;
	daemon?: boolean;
	port?: number;
}

// ---------------------------------------------------------------------------
// Non-interactive setup (for CI / automated environments)
// ---------------------------------------------------------------------------

function agentNameFromFlag(flag: string): keyof BroskiConfig["agents"] | null {
	const lower = flag.toLowerCase().trim();
	if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claudeCode";
	if (lower === "pi") return "pi";
	if (lower === "antigravity" || lower === "agy") return "antigravity";
	return null;
}

function daemonTypeLabel(): string {
	return IS_MACOS ? "LaunchAgent" : "none";
}

async function runNonInteractiveSetup(options: OnboardingOptions): Promise<void> {
	const log = (msg: string) => console.log(`[broski] ${msg}`);
	const existing = await readConfig();

	log("Non-interactive setup");

	// 1. Agents — use flag or auto-detect
	let agents: BroskiConfig["agents"];
	if (options.agents && options.agents.length > 0) {
		agents = { claudeCode: false, pi: false, antigravity: false };
		for (const a of options.agents) {
			const name = agentNameFromFlag(a);
			if (name !== null) agents[name] = true;
			else log(`Warning: unknown agent "${a}", skipping`);
		}
	} else {
		const detected = detectAgents(existing);
		agents = { claudeCode: detected.claudeCode.found, pi: detected.pi.found, antigravity: detected.antigravity.found };
	}

	const agentNames: string[] = [];
	if (agents.claudeCode) agentNames.push("Claude Code");
	if (agents.pi) agentNames.push("Pi");
	if (agents.antigravity) agentNames.push("Antigravity");
	log(`Agents: ${agentNames.length > 0 ? agentNames.join(", ") : "none detected"}`);

	// 2. Port
	const port = options.port ?? 18274;
	log(`Port: ${port}`);

	// 3. Security
	const tlsEnabled = options.tls !== undefined ? options.tls : true;
	log(`Security: TLS ${tlsEnabled ? "enabled" : "disabled"}`);

	// 4. TLS cert (best-effort, silent failure)
	if (tlsEnabled) {
		try {
			const { ensureTlsMaterial } = await import("../tls");
			await ensureTlsMaterial();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`Warning: TLS cert setup failed (${msg}), continuing`);
		}
	}

	// 5. Daemon
	const shouldInstallDaemon = options.daemon !== undefined ? options.daemon : true;
	let daemonInstalled = false;
	let daemonType: DaemonType = "none";

	if (getDaemonType() === "none") {
		log("Daemon: skipped (background service is available on macOS only)");
	} else if (shouldInstallDaemon) {
		try {
			const logDir = resolve(homedir(), ".broski", "logs");
			await mkdir(logDir, { recursive: true });

			const daemonConfig: DaemonConfig = {
				binaryPath: getBroskiBinaryPath(),
				args: ["--daemon"],
				logDir,
				workDir: homedir(),
			};
			await installDaemon(daemonConfig);
			daemonInstalled = true;
			daemonType = getDaemonType();
			log(`Daemon: installed (${daemonTypeLabel()})`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`Warning: Daemon install failed (${msg}), skipping`);
		}
	} else {
		log("Daemon: skipped (--no-daemon)");
	}

	// 6. Write config
	const finalConfig = setupConfig(existing, {
		port,
		tls: tlsEnabled,
		agents,
		daemon: { installed: daemonInstalled, type: daemonType },
	});

	await writeConfig(finalConfig);

	const configPath = getConfigPath();
	log(`Config written to ${configPath}`);
	log("Setup complete. Run 'broski' to start.");
}

export async function runOnboardingWizard(prompter: WizardPrompter | null, options?: OnboardingOptions): Promise<void> {
	if (options?.nonInteractive) {
		await runNonInteractiveSetup(options);
		return;
	}

	if (!prompter) {
		throw new Error("Prompter is required for interactive setup mode");
	}

	try {
		// 1. Read existing config
		let config = await readConfig();

		// 2. Welcome step
		const welcome = await runWelcomeStep(prompter, config);

		if (welcome.action === "keep") {
			await prompter.outro(brand("Keeping current settings. Run ") + muted("broski") + brand(" to start."));
			return;
		}

		if (welcome.action === "reset") {
			config = getDefaultConfig();
		}

		// 3. Determine mode (quick vs advanced)
		let isQuick: boolean;
		if (options?.quick) {
			isQuick = true;
		} else if (options?.advanced) {
			isQuick = false;
		} else {
			const mode = await prompter.select<"quick" | "advanced">({
				message: "How would you like to set up?",
				options: [
					{ value: "quick", label: "QuickStart (recommended)", hint: "auto-detect everything" },
					{ value: "advanced", label: "Advanced", hint: "customize each setting" },
				],
				initialValue: "quick",
			});
			isQuick = mode === "quick";
		}

		// 4. Agents step
		const agents = await runAgentsStep(prompter, { isQuick, config });

		// 5. Security step
		const security = await runSecurityStep(prompter, { isQuick });

		// 6. Daemon step
		const daemon = await runDaemonStep(prompter);

		// 7. Assemble final config
		const finalConfig = setupConfig(config, {
			port: config.network.port,
			tls: security.tls,
			agents,
			daemon,
		});

		// 8. Write config
		await writeConfig(finalConfig);

		// 9. Validate setup
		const runValidation = await prompter.confirm({
			message: "Run post-setup validation now? (recommended)",
			initialValue: true,
		});

		if (runValidation) {
			const { runDoctor } = await import("../doctor");
			await runDoctor({ profile: "pairing" });
			if (finalConfig.agents.claudeCode || finalConfig.agents.pi || finalConfig.agents.antigravity) {
				await runDoctor({ profile: "agents" });
			}
		}

		// 10. Finalize
		await runFinalizeStep(prompter, finalConfig);
	} catch (err) {
		if (err instanceof WizardCancelledError) {
			await prompter.outro(`${warning("Setup cancelled.")} Run ${brand("broski setup")} to try again.`);
			return;
		}
		throw err;
	}
}
