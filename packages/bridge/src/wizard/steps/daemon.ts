import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	type DaemonConfig,
	type DaemonType,
	getBroskiBinaryPath,
	getDaemonStatus,
	getDaemonType,
	IS_LINUX,
	IS_MACOS,
	installDaemon,
} from "../../platform";
import { bold, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

export type DaemonResult = {
	installed: boolean;
	type: DaemonType;
};

function daemonTypeLabel(): string {
	if (IS_MACOS) return "LaunchAgent";
	if (IS_LINUX) return "systemd service";
	return "background service";
}

export async function runDaemonStep(prompter: WizardPrompter): Promise<DaemonResult> {
	if (getDaemonType() === "none") {
		await prompter.note(
			`  ${muted("Broski Link runs as a background service on macOS and Linux only.")}`,
			"Background Service",
		);
		return { installed: false, type: "none" };
	}

	const status = await getDaemonStatus();

	if (status.installed && status.running) {
		await prompter.note(
			`  ${success("✓")} ${daemonTypeLabel()} is already installed and running.\n` +
				`  ${muted(`PID: ${status.pid ?? "unknown"}`)}`,
			"Background Service",
		);
		return { installed: true, type: getDaemonType() };
	}

	if (status.installed && !status.running) {
		await prompter.note(
			`  ${warning("⚠")} ${daemonTypeLabel()} is installed but not running.\n` +
				`  ${muted("It will start automatically on next login.")}`,
			"Background Service",
		);
		return { installed: true, type: getDaemonType() };
	}

	// Not installed — ask
	const shouldInstall = await prompter.confirm({
		message: `Run Broski on startup? (${daemonTypeLabel()}, recommended)`,
		initialValue: true,
	});

	if (!shouldInstall) {
		return { installed: false, type: "none" };
	}

	// Install daemon
	const logDir = resolve(homedir(), ".broski", "logs");
	await mkdir(logDir, { recursive: true });

	const daemonConfig: DaemonConfig = {
		binaryPath: getBroskiBinaryPath(),
		args: ["--daemon"],
		logDir,
		workDir: homedir(),
	};

	const spin = prompter.spinner();
	spin.start(`Installing ${daemonTypeLabel()}...`);

	try {
		await installDaemon(daemonConfig);
		spin.stop(`${success("✓")} ${daemonTypeLabel()} installed ${muted("(starts on login)")}`);
		return { installed: true, type: getDaemonType() };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		spin.stop(`${warning("⚠")} Failed to install: ${msg}`);

		await prompter.note(`${muted("You can install it later with:")} ${bold("broski install")}`, "Manual Install");
		return { installed: false, type: "none" };
	}
}
