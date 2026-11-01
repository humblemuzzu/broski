import { type DoctorProfile, runDoctor } from "../doctor";
import { WizardCancelledError } from "./errors";
import { bold, brand, header, muted, warning } from "./palette";
import type { WizardPrompter } from "./prompter";

type Problem =
	| "phone-cant-connect"
	| "sessions-not-showing"
	| "bridge-crashing"
	| "agent-not-responding"
	| "something-else";

function profileForProblem(problem: Problem): DoctorProfile {
	switch (problem) {
		case "phone-cant-connect":
			return "network";
		case "sessions-not-showing":
			return "agents";
		case "bridge-crashing":
			return "daemon";
		case "agent-not-responding":
			return "agents";
		case "something-else":
			return "all";
	}
}

export async function runTroubleshootWizard(prompter: WizardPrompter): Promise<void> {
	try {
		await prompter.intro(header("  BROSKI  ") + muted(" — Troubleshooter"));

		const problem = await prompter.select<Problem>({
			message: "What's the problem?",
			options: [
				{ value: "phone-cant-connect", label: "Phone can't connect", hint: "network / pairing path" },
				{ value: "sessions-not-showing", label: "Sessions not showing up", hint: "backend/session discovery path" },
				{ value: "bridge-crashing", label: "Bridge keeps crashing", hint: "daemon/runtime path" },
				{ value: "agent-not-responding", label: "Agent not responding", hint: "backend path" },
				{ value: "something-else", label: "Something else", hint: "full diagnostic path" },
			],
		});

		await showDiagnosis(prompter, problem);

		const profile = profileForProblem(problem);
		const runFocused = await prompter.confirm({
			message: `Run focused diagnostics now? (broski doctor --profile ${profile})`,
			initialValue: true,
		});

		if (runFocused) {
			await prompter.note(muted(`Running doctor profile: ${profile}...`), "Diagnostics");
			await runDoctor({ profile });

			const runFix = await prompter.confirm({
				message: "Try safe auto-fixes now? (broski doctor --fix)",
				initialValue: true,
			});
			if (runFix) {
				await runDoctor({ profile, fix: true });
			}
		}

		const exportBundle = await prompter.confirm({
			message: "Export diagnostics bundle for support/AI help?",
			initialValue: true,
		});

		if (exportBundle) {
			await runDoctor({ profile, export: true });
		}

		const helped = await prompter.confirm({
			message: "Did this resolve your issue?",
			initialValue: true,
		});

		if (helped) {
			await prompter.outro(brand("Great! Happy vibe coding."));
		} else {
			await prompter.note(
				`${bold("Still stuck? Run these in order:")}\n\n` +
					`  ${brand(`broski doctor --deep --profile ${profile}`)}\n` +
					`  ${brand(`broski doctor --fix --profile ${profile}`)}\n` +
					`  ${brand("broski logs --follow")}\n` +
					`  ${brand("broski logs --export")}\n\n` +
					`${muted("Then share the diagnostics export with support or your AI assistant.")}`,
				"Escalation Path",
			);
			await prompter.outro(muted("You can rerun this anytime with `broski troubleshoot`."));
		}
	} catch (err) {
		if (err instanceof WizardCancelledError) {
			await prompter.outro(`${warning("Troubleshooter cancelled.")} Run ${brand("broski troubleshoot")} anytime.`);
			return;
		}
		throw err;
	}
}

async function showDiagnosis(prompter: WizardPrompter, problem: Problem): Promise<void> {
	switch (problem) {
		case "phone-cant-connect":
			await prompter.note(
				`${bold("Most likely causes:")}\n\n` +
					`  ${bold("1.")} Bridge is not running\n` +
					`     ${muted("Run:")} ${brand("broski")}\n\n` +
					`  ${bold("2.")} Broski Link is not running\n` +
					`     ${muted("Check:")} ${brand("broski status")} ${muted("and")} ${brand("broski-link status")}\n\n` +
					`  ${bold("3.")} Phone is not paired\n` +
					`     ${muted("Run:")} ${brand("broski-link pair")}`,
				"Phone Connection Issues",
			);
			break;

		case "sessions-not-showing":
			await prompter.note(
				`${bold("Most likely causes:")}\n\n` +
					`  ${bold("1.")} Backend binary not installed\n` +
					`  ${bold("2.")} Backend process not running\n` +
					`  ${bold("3.")} Bridge needs refresh/restart\n\n` +
					`${muted("Run:")} ${brand("broski doctor --profile agents")}`,
				"Missing Sessions",
			);
			break;

		case "bridge-crashing":
			await prompter.note(
				`${bold("Fast path:")}\n\n` +
					`  ${brand("broski doctor --profile daemon")}\n` +
					`  ${brand("broski logs --follow")}\n\n` +
					`${muted("If port conflicts appear, doctor output will show exact kill command.")}`,
				"Bridge Crashes",
			);
			break;

		case "agent-not-responding":
			await prompter.note(
				`${bold("Install commands (official):")}\n\n` +
					`  ${muted("Claude Code:")} ${brand("curl -fsSL https://claude.ai/install.sh | bash")}\n` +
					`  ${muted("Pi:")}          ${brand("npm i -g @earendil-works/pi-coding-agent")}\n\n` +
					`${muted("Then run:")} ${brand("broski doctor --profile agents")}`,
				"Agent Issues",
			);
			break;

		case "something-else":
			await prompter.note(
				`${bold("No problem — run full diagnostics.")}

` +
					`${muted("Recommended:")} ${brand("broski doctor --deep")}\n` +
					`${muted("Then:")} ${brand("broski logs --export")}`,
				"Full Diagnosis",
			);
			break;
	}
}
