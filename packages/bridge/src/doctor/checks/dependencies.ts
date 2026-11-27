import type { BroskiConfig } from "../../config";
import { resolveAgyCli } from "../../server/antigravity-cli-path";
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

	const agy = resolveAgyCli(config?.antigravity.cliPath).found;
	const any = Boolean(claude || pi || agy);
	if (!any) {
		results.push({
			id: "any_agent",
			category: "dependencies",
			status: "error",
			message: "No supported AI backend found (Claude Code/Pi/Antigravity)",
			fix: "Install Claude Code, Pi or Antigravity CLI",
		});
	} else {
		const names = [claude && "Claude Code", pi && "Pi", agy && "Antigravity"].filter(Boolean);
		results.push({
			id: "any_agent",
			category: "dependencies",
			status: "ok",
			message: `Available backends: ${names.join(", ")}`,
		});
	}

	return results;
}
