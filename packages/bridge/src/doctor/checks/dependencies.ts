import type { BroskiConfig } from "../../config";
import { findBinary } from "../../platform";
import { defaultClaudeCliEnvironment, resolveClaudeCliPath } from "../../server/claude-cli-path";
import type { CheckResult } from "../types";
import { claudeCliCheck } from "./claude-cli";

const PI_FIX = "Install Pi: npm i -g @earendil-works/pi-coding-agent";

export async function runDependencyChecks(config?: BroskiConfig): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const claudeResult = claudeCliCheck(resolveClaudeCliPath(defaultClaudeCliEnvironment(config?.claudeCode.cliPath)));
	results.push(claudeResult);
	const claude = claudeResult.status === "ok";

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
			fix: "Install Claude Code or Pi",
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
