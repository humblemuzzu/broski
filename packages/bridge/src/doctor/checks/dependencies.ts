import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { findBinary } from "../../platform";
import type { CheckResult } from "../types";

const CLAUDE_FIX = "Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash";
const PI_FIX = "Install Pi: npm i -g @earendil-works/pi-coding-agent";

export async function runDependencyChecks(): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const claude = findBinary("claude");
	const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
	const hasClaudeSettings = existsSync(resolve(homedir(), ".claude", "settings.json"));
	if (!claude) {
		results.push({
			id: "claude_code",
			category: "dependencies",
			status: "warning",
			message: "Claude Code not found",
			fix: CLAUDE_FIX,
		});
	} else {
		const auth = hasAnthropicKey ? "API key set" : hasClaudeSettings ? "settings.json found" : "auth not configured";
		results.push({
			id: "claude_code",
			category: "dependencies",
			status: "ok",
			message: `Claude Code found (${auth})`,
		});
	}

	const pi = findBinary("pi");
	if (!pi) {
		results.push({
			id: "pi",
			category: "dependencies",
			status: "warning",
			message: "Pi not found",
			fix: PI_FIX,
		});
	} else {
		results.push({ id: "pi", category: "dependencies", status: "ok", message: "Pi found" });
	}

	const any = Boolean(claude || pi);
	if (!any) {
		results.push({
			id: "any_agent",
			category: "dependencies",
			status: "error",
			message: "No supported AI backend found (Claude Code/Pi)",
			fix: CLAUDE_FIX,
		});
	} else {
		const names = [claude && "Claude Code", pi && "Pi"].filter(Boolean);
		results.push({
			id: "any_agent",
			category: "dependencies",
			status: "ok",
			message: `Available backends: ${names.join(", ")}`,
		});
	}

	return results;
}
