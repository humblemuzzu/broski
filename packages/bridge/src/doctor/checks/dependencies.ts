import type { BroskiConfig } from "../../config";
import { defaultClaudeCliEnvironment, resolveClaudeCliPath } from "../../server/claude-cli-path";
import { resolvePiCli } from "../../server/pi-cli-path";
import type { CheckResult } from "../types";
import { claudeCliCheck } from "./claude-cli";
import { piCliCheck } from "./pi-cli";

export async function runDependencyChecks(config?: BroskiConfig): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const claudeResult = claudeCliCheck(resolveClaudeCliPath(defaultClaudeCliEnvironment(config?.claudeCode.cliPath)));
	results.push(claudeResult);
	const claude = claudeResult.status === "ok";

	const piResult = await piCliCheck(resolvePiCli(config?.pi.cliPath));
	results.push(piResult);
	const pi = piResult.status === "ok";

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
