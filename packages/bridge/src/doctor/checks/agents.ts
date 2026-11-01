import { homedir } from "node:os";
import { resolve } from "node:path";
import { findBinary } from "../../platform";
import type { CheckResult } from "../types";
import { dirExists } from "../utils";

export async function runAgentChecks(): Promise<CheckResult[]> {
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

	// Pi config check
	try {
		const piPath = findBinary("pi");
		if (piPath) {
			results.push({
				id: "pi_config",
				category: "agents",
				status: "ok",
				message: "Pi agent available",
			});
		} else {
			results.push({
				id: "pi_config",
				category: "agents",
				status: "info",
				message: "Pi agent not installed (optional)",
			});
		}
	} catch {
		results.push({
			id: "pi_config",
			category: "agents",
			status: "info",
			message: "Pi agent not installed (optional)",
		});
	}

	return results;
}
