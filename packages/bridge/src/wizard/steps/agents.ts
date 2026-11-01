import { findBinary } from "../../platform";
import { bold, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

export type AgentsResult = {
	claudeCode: boolean;
	pi: boolean;
};

interface DetectedAgents {
	claudeCode: { found: boolean; path: string | null };
	pi: { found: boolean; path: string | null };
}

function detectAgents(): DetectedAgents {
	const cc = findBinary("claude");
	const pi = findBinary("pi");
	return {
		claudeCode: { found: !!cc, path: cc },
		pi: { found: !!pi, path: pi },
	};
}

export async function runAgentsStep(prompter: WizardPrompter, options: { isQuick: boolean }): Promise<AgentsResult> {
	const detected = detectAgents();
	const foundCount = [detected.claudeCode, detected.pi].filter((a) => a.found).length;

	if (options.isQuick) {
		const lines: string[] = [];
		if (detected.claudeCode.found) {
			lines.push(`  ${success("✓")} Claude Code ${muted(`(${detected.claudeCode.path})`)}`);
		}
		if (detected.pi.found) {
			lines.push(`  ${success("✓")} Pi ${muted(`(${detected.pi.path})`)}`);
		}

		if (foundCount === 0) {
			lines.push(`  ${warning("⚠")} No agents detected on PATH`);
			lines.push(`  ${muted("Install at least one agent to use Broski.")}`);
		}

		await prompter.note(
			foundCount > 0
				? `Found ${bold(String(foundCount))} agent${foundCount > 1 ? "s" : ""} installed:\n\n${lines.join("\n")}`
				: lines.join("\n"),
			"Agent Detection",
		);

		return {
			claudeCode: detected.claudeCode.found,
			pi: detected.pi.found,
		};
	}

	const selected = await prompter.multiselect<string>({
		message: "Which agents do you want to use?",
		options: [
			{
				value: "claudeCode",
				label: `Claude Code ${detected.claudeCode.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.claudeCode.found
					? (detected.claudeCode.path ?? undefined)
					: "curl -fsSL https://claude.ai/install.sh | bash",
			},
			{
				value: "pi",
				label: `Pi ${detected.pi.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.pi.found ? (detected.pi.path ?? undefined) : "npm i -g @earendil-works/pi-coding-agent",
			},
		],
	});

	const warnings: string[] = [];
	if (selected.includes("claudeCode") && !detected.claudeCode.found) {
		warnings.push(
			`  ${warning("⚠")} Claude Code not found. Install: ${bold("curl -fsSL https://claude.ai/install.sh | bash")}`,
		);
	}
	if (selected.includes("pi") && !detected.pi.found) {
		warnings.push(`  ${warning("⚠")} Pi not found. Install: ${bold("npm i -g @earendil-works/pi-coding-agent")}`);
	}
	if (warnings.length > 0) {
		await prompter.note(warnings.join("\n"), "Missing Agents");
	}

	return {
		claudeCode: selected.includes("claudeCode"),
		pi: selected.includes("pi"),
	};
}
