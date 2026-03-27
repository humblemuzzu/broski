/**
 * Codex agents (AGENTS.md) handler.
 * Extracted from server.ts — cases: cx_agents_read, cx_agents_write
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CxAgentsHandlerContext = {
	safeString: (v: unknown) => string;
	getSecurePath: (path: string) => Promise<string | null>;
};

export async function handleCxAgents(
	message: any,
	reply: (msg: any) => void,
	ctx: CxAgentsHandlerContext,
): Promise<boolean> {
	const { safeString, getSecurePath } = ctx;

	switch (message.type) {
		case "cx_agents_read": {
			const requestedCwd = safeString(message.cwd).trim();
			const secureCwd = requestedCwd ? await getSecurePath(requestedCwd) : null;
			if (!secureCwd) {
				reply({ type: "error", message: "Access denied" });
				return true;
			}
			const agentsPath = resolve(secureCwd, "AGENTS.md");
			try {
				const content = await readFile(agentsPath, "utf8");
				reply({
					type: "cx_agents",
					data: { exists: true, path: agentsPath, content },
				});
			} catch {
				reply({
					type: "cx_agents",
					data: { exists: false, path: agentsPath, content: "" },
				});
			}
			return true;
		}
		case "cx_agents_write": {
			const requestedCwd = safeString(message.cwd).trim();
			const secureCwd = requestedCwd ? await getSecurePath(requestedCwd) : null;
			if (!secureCwd) {
				reply({ type: "error", message: "Access denied" });
				return true;
			}
			const agentsPath = resolve(secureCwd, "AGENTS.md");
			try {
				await writeFile(agentsPath, message.content ?? "", "utf8");
				reply({
					type: "cx_agents_written",
					data: { ok: true, path: agentsPath },
				});
			} catch {
				reply({
					type: "cx_agents_written",
					data: { ok: false, path: agentsPath },
				});
			}
			return true;
		}
		default:
			return false;
	}
}
