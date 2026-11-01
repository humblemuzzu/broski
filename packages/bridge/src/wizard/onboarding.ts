import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import packageMeta from "../../package.json";
import { getConfigPath, readConfig, writeConfig } from "../config";
import { getDefaultConfig } from "../config/defaults";
import type { BroskiConfig } from "../config/schema";
import {
	type DaemonConfig,
	type DaemonType,
	findBinary,
	getBroskiBinaryPath,
	getDaemonType,
	IS_LINUX,
	IS_MACOS,
	installDaemon,
} from "../platform";
import { WizardCancelledError } from "./errors";
import { brand, muted, warning } from "./palette";
import type { WizardPrompter } from "./prompter";
import { runAgentsStep } from "./steps/agents";
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

function detectAgentsNonInteractive(): { claudeCode: boolean; pi: boolean } {
	return {
		claudeCode: !!findBinary("claude"),
		pi: !!findBinary("pi"),
	};
}

function agentNameFromFlag(flag: string): "claude" | "pi" | null {
	const lower = flag.toLowerCase().trim();
	if (lower === "claude" || lower === "claude-code" || lower === "claudecode") return "claude";
	if (lower === "pi") return "pi";
	return null;
}

function daemonTypeLabel(): string {
	if (IS_MACOS) return "LaunchAgent";
	if (IS_LINUX) return "systemd";
	return "none";
}

async function runNonInteractiveSetup(options: OnboardingOptions): Promise<void> {
	const log = (msg: string) => console.log(`[broski] ${msg}`);

	log("Non-interactive setup");

	// 1. Agents — use flag or auto-detect
	let agents: { claudeCode: boolean; pi: boolean };
	if (options.agents && options.agents.length > 0) {
		agents = { claudeCode: false, pi: false };
		for (const a of options.agents) {
			const name = agentNameFromFlag(a);
			if (name === "claude") agents.claudeCode = true;
			else if (name === "pi") agents.pi = true;
			else log(`Warning: unknown agent "${a}", skipping`);
		}
	} else {
		agents = detectAgentsNonInteractive();
	}

	const agentNames: string[] = [];
	if (agents.claudeCode) agentNames.push("Claude Code");
	if (agents.pi) agentNames.push("Pi");
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
		log("Daemon: skipped (background service is available on macOS and Linux only)");
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

	// 6. Write config (spread defaults for cloud/pi sections not configured by quick setup)
	const defaults = getDefaultConfig();
	const finalConfig: BroskiConfig = {
		...defaults,
		version: 1,
		wizard: {
			completedSetup: true,
			lastRunAt: new Date().toISOString(),
			lastRunVersion: packageMeta.version ?? "0.1.0",
		},
		network: {
			port,
		},
		security: {
			tls: tlsEnabled,
			verifyCodeSignature: defaults.security.verifyCodeSignature,
		},
		agents: {
			claudeCode: agents.claudeCode,
			pi: agents.pi,
		},
		daemon: {
			installed: daemonInstalled,
			type: daemonType,
		},
	};

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
		const agents = await runAgentsStep(prompter, { isQuick });

		// 5. Security step
		const security = await runSecurityStep(prompter, { isQuick });

		// 6. Daemon step
		const daemon = await runDaemonStep(prompter);

		// 7. Assemble final config (spread defaults for sections not configured by wizard)
		const wizardDefaults = getDefaultConfig();
		const finalConfig: BroskiConfig = {
			...wizardDefaults,
			version: 1,
			wizard: {
				completedSetup: true,
				lastRunAt: new Date().toISOString(),
				lastRunVersion: packageMeta.version ?? "0.1.0",
			},
			network: {
				port: config.network.port,
			},
			security: {
				tls: security.tls,
				verifyCodeSignature: wizardDefaults.security.verifyCodeSignature,
			},
			agents: {
				claudeCode: agents.claudeCode,
				pi: agents.pi,
			},
			daemon: {
				installed: daemon.installed,
				type: daemon.type,
			},
		};

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
			if (finalConfig.agents.claudeCode || finalConfig.agents.pi) {
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
