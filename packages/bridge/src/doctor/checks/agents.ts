import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BroskiConfig } from "../../config";
import { resolvePiCli } from "../../server/pi-cli-path";
import type { CheckResult } from "../types";
import { dirExists } from "../utils";

export async function runAgentChecks(config?: BroskiConfig): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const ccProjects = resolve(homedir(), ".claude", "projects");
	results.push({
		id: "claude_projects",
		category: "agents",
		status: (await dirExists(ccProjects)) ? "info" : "info",
		message: (await dirExists(ccProjects))
			? "Claude Code projects directory exists"
			: "No Claude Code projects directory found yet",
	});

	const pi = resolvePiCli(config?.pi.cliPath);
	results.push({
		id: "pi_config",
		category: "agents",
		status: pi.found ? "ok" : "info",
		message: pi.found ? "Pi agent available" : "Pi agent not installed (optional)",
	});

	return results;
}
