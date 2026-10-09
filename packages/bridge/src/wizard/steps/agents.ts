import { findBinary } from "../../platform";
import { bold, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

export type AgentsResult = {
	opencode: boolean;
	claudeCode: boolean;
	codex: boolean;
	pi: boolean;
};

interface DetectedAgents {
	opencode: { found: boolean; path: string | null };
	claudeCode: { found: boolean; path: string | null };
	codex: { found: boolean; path: string | null };
	pi: { found: boolean; path: string | null };
}

function detectAgents(): DetectedAgents {
	const oc = findBinary("opencode");
	const cc = findBinary("claude");
	const cx = findBinary("codex");
	const pi = findBinary("pi");
	return {
		opencode: { found: !!oc, path: oc },
		claudeCode: { found: !!cc, path: cc },
		codex: { found: !!cx, path: cx },
		pi: { found: !!pi, path: pi },
	};
}

export async function runAgentsStep(prompter: WizardPrompter, options: { isQuick: boolean }): Promise<AgentsResult> {
	const detected = detectAgents();
	const foundCount = [detected.opencode, detected.claudeCode, detected.codex, detected.pi].filter(
		(a) => a.found,
	).length;

	if (options.isQuick) {
		// QuickStart: auto-detect and report
		const lines: string[] = [];
		if (detected.opencode.found) {
			lines.push(`  ${success("✓")} OpenCode ${muted(`(${detected.opencode.path})`)}`);
		}
		if (detected.claudeCode.found) {
			lines.push(`  ${success("✓")} Claude Code ${muted(`(${detected.claudeCode.path})`)}`);
		}
		if (detected.codex.found) {
			lines.push(`  ${success("✓")} Codex ${muted(`(${detected.codex.path})`)}`);
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
			opencode: detected.opencode.found,
			claudeCode: detected.claudeCode.found,
			codex: detected.codex.found,
			pi: detected.pi.found,
		};
	}

	// Advanced: let user choose
	const selected = await prompter.multiselect<string>({
		message: "Which agents do you want to use?",
		options: [
			{
				value: "opencode",
				label: `OpenCode ${detected.opencode.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.opencode.found
					? (detected.opencode.path ?? undefined)
					: "curl -fsSL https://opencode.ai/install | bash",
			},
			{
				value: "claudeCode",
				label: `Claude Code ${detected.claudeCode.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.claudeCode.found
					? (detected.claudeCode.path ?? undefined)
					: "curl -fsSL https://claude.ai/install.sh | bash",
			},
			{
				value: "codex",
				label: `Codex ${detected.codex.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.codex.found ? (detected.codex.path ?? undefined) : "npm i -g @openai/codex",
			},
			{
				value: "pi",
				label: `Pi ${detected.pi.found ? success("(detected)") : warning("(not found)")}`,
				hint: detected.pi.found ? (detected.pi.path ?? undefined) : "npm i -g @earendil-works/pi-coding-agent",
			},
		],
	});

	// Show warnings for selected but not-found agents
	const warnings: string[] = [];
	if (selected.includes("opencode") && !detected.opencode.found) {
		warnings.push(
			`  ${warning("⚠")} OpenCode not found. Install: ${bold("curl -fsSL https://opencode.ai/install | bash")}`,
		);
	}
	if (selected.includes("claudeCode") && !detected.claudeCode.found) {
		warnings.push(
			`  ${warning("⚠")} Claude Code not found. Install: ${bold("curl -fsSL https://claude.ai/install.sh | bash")}`,
		);
	}
	if (selected.includes("codex") && !detected.codex.found) {
		warnings.push(`  ${warning("⚠")} Codex not found. Install: ${bold("npm i -g @openai/codex")}`);
	}
	if (selected.includes("pi") && !detected.pi.found) {
		warnings.push(`  ${warning("⚠")} Pi not found. Install: ${bold("npm i -g @earendil-works/pi-coding-agent")}`);
	}
	if (warnings.length > 0) {
		await prompter.note(warnings.join("\n"), "Missing Agents");
	}

	return {
		opencode: selected.includes("opencode"),
		claudeCode: selected.includes("claudeCode"),
		codex: selected.includes("codex"),
		pi: selected.includes("pi"),
	};
}
