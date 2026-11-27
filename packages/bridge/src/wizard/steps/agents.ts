import { AGY_INSTALL_PAGE } from "../../backends/antigravity/install";
import { PI_INSTALL_COMMAND } from "../../backends/pi/pi-install";
import type { BroskiConfig } from "../../config/schema";
import { resolveAgyCli } from "../../server/antigravity-cli-path";
import { defaultClaudeCliEnvironment, resolveClaudeCliPath } from "../../server/claude-cli-path";
import { resolvePiCli } from "../../server/pi-cli-path";
import { bold, muted, success, warning } from "../palette";
import type { WizardPrompter } from "../prompter";

export type AgentsResult = BroskiConfig["agents"];

type AgentKey = keyof AgentsResult;

export type DetectedAgents = Record<AgentKey, { found: boolean; path: string | null }>;

type AgentConfig = Pick<BroskiConfig, "claudeCode" | "pi" | "antigravity">;

const AGENTS: ReadonlyArray<{ readonly key: AgentKey; readonly name: string; readonly install: string }> = [
	{ key: "claudeCode", name: "Claude Code", install: "curl -fsSL https://claude.ai/install.sh | bash" },
	{ key: "pi", name: "Pi", install: PI_INSTALL_COMMAND },
	{ key: "antigravity", name: "Antigravity", install: AGY_INSTALL_PAGE },
];

/** The `claude`, `pi` and `agy` the bridge would run: the ones it resolves, from the config's `cliPath` keys, else `PATH`. */
export function detectAgents(config: AgentConfig, which?: (name: string) => string | null): DetectedAgents {
	const claude = resolveClaudeCliPath({
		...defaultClaudeCliEnvironment(config.claudeCode.cliPath),
		...(which !== undefined && { which }),
	});
	const pi = resolvePiCli(config.pi.cliPath, which);
	const agy = resolveAgyCli(config.antigravity.cliPath, which);
	return {
		claudeCode: { found: claude.ok, path: claude.ok ? claude.path : null },
		pi: { found: pi.found, path: pi.found ? pi.path : null },
		antigravity: { found: agy.found, path: agy.found ? agy.path : null },
	};
}

export async function runAgentsStep(
	prompter: WizardPrompter,
	options: { isQuick: boolean; config: AgentConfig },
): Promise<AgentsResult> {
	const detected = detectAgents(options.config);
	if (options.isQuick) {
		await quickNote(prompter, detected);
		return { claudeCode: detected.claudeCode.found, pi: detected.pi.found, antigravity: detected.antigravity.found };
	}
	const selected = await prompter.multiselect<string>({
		message: "Which agents do you want to use?",
		options: AGENTS.map(({ key, name, install }) => ({
			value: key,
			label: `${name} ${detected[key].found ? success("(detected)") : warning("(not found)")}`,
			hint: detected[key].found ? (detected[key].path ?? undefined) : install,
		})),
	});
	const warnings = AGENTS.filter(({ key }) => selected.includes(key) && !detected[key].found).map(
		({ name, install }) => `  ${warning("⚠")} ${name} not found. Install: ${bold(install)}`,
	);
	if (warnings.length > 0) {
		await prompter.note(warnings.join("\n"), "Missing Agents");
	}
	return {
		claudeCode: selected.includes("claudeCode"),
		pi: selected.includes("pi"),
		antigravity: selected.includes("antigravity"),
	};
}

async function quickNote(prompter: WizardPrompter, detected: DetectedAgents): Promise<void> {
	const found = AGENTS.filter(({ key }) => detected[key].found);
	const lines = found.map(({ key, name }) => `  ${success("✓")} ${name} ${muted(`(${detected[key].path})`)}`);
	if (found.length === 0) {
		lines.push(`  ${warning("⚠")} No agents detected on PATH`);
		lines.push(`  ${muted("Install at least one agent to use Broski.")}`);
	}
	await prompter.note(
		found.length > 0
			? `Found ${bold(String(found.length))} agent${found.length > 1 ? "s" : ""} installed:\n\n${lines.join("\n")}`
			: lines.join("\n"),
		"Agent Detection",
	);
}
