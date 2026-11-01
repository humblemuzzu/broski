import type { BroskiConfig } from "../../config/schema";
import { bold, brand, muted, success } from "../palette";
import type { WizardPrompter } from "../prompter";

function formatAgents(config: BroskiConfig): string {
	const agents: string[] = [];
	if (config.agents.claudeCode) agents.push("Claude Code");
	if (config.agents.pi) agents.push("Pi");
	return agents.length > 0 ? agents.join(", ") : muted("none configured");
}

function formatSecurity(config: BroskiConfig): string {
	return config.security.tls ? success("Loopback TLS enabled") : "Loopback TLS disabled";
}

function formatDaemon(config: BroskiConfig): string {
	if (!config.daemon.installed) return muted("not installed");
	const typeLabels: Record<string, string> = {
		launchagent: "LaunchAgent",
		systemd: "systemd",
	};
	return success(`Installed (${typeLabels[config.daemon.type] ?? config.daemon.type})`);
}

export async function runFinalizeStep(prompter: WizardPrompter, config: BroskiConfig): Promise<void> {
	// Summary card
	await prompter.note(
		`  ${bold("Agents:")}    ${formatAgents(config)}\n` +
			`  ${bold("Port:")}      ${config.network.port}\n` +
			`  ${bold("Security:")}  ${formatSecurity(config)}\n` +
			`  ${bold("Daemon:")}    ${formatDaemon(config)}`,
		"Configuration Summary",
	);

	// Next steps
	await prompter.note(
		`  ${brand("broski install")}      ${muted("— Set up Always On (runs the bridge via broski-link)")}\n` +
			`  ${brand("broski-link pair")}     ${muted("— Show the pairing QR for your phone")}\n` +
			`  ${brand("broski doctor")}        ${muted("— Run diagnostics")}\n` +
			`  ${brand("broski logs --export")}  ${muted("— Export support bundle")}\n` +
			`  ${brand("broski configure")}     ${muted("— Change settings")}\n` +
			`  ${brand("broski troubleshoot")}  ${muted("— Guided troubleshooting")}`,
		"Next Steps",
	);

	await prompter.outro(success("You're all set! ") + brand("Vibe code from anywhere."));
}
