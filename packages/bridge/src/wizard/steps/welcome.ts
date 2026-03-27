import type { BroskiConfig } from "../../config/schema";
import { bold, brand, header, muted } from "../palette";
import type { WizardPrompter } from "../prompter";

export type WelcomeResult = {
	action: "continue" | "modify" | "reset" | "keep";
};

export async function runWelcomeStep(prompter: WizardPrompter, config: BroskiConfig): Promise<WelcomeResult> {
	await prompter.intro(header("  BROSKI  ") + muted(" — Setup Wizard"));

	await prompter.note(
		`${brand("Control your AI coding agents from your phone.")}\n\n` +
			`${muted("This wizard will help you configure:")}\n` +
			`  ${bold("1.")} Agent detection (OpenCode, Claude Code, Codex, Pi)\n` +
			`  ${bold("2.")} Network & connectivity\n` +
			`  ${bold("3.")} Security (TLS, auth tokens)\n` +
			`  ${bold("4.")} Background service (daemon)`,
		"Welcome",
	);

	if (config.wizard.completedSetup) {
		const action = await prompter.select<WelcomeResult["action"]>({
			message: "Found existing configuration. What would you like to do?",
			options: [
				{ value: "keep", label: "Keep current settings", hint: "exit wizard" },
				{ value: "modify", label: "Modify settings", hint: "step through each section" },
				{ value: "reset", label: "Reset to defaults", hint: "start fresh" },
			],
		});
		return { action };
	}

	return { action: "continue" };
}
