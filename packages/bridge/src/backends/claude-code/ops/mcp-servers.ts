/**
 * `mcp_servers` (D22): the session's MCP servers by live status. Enabling and disabling go through the CLI, which
 * writes the per-project list in its own `.claude.json` itself (verified in `real_cli.test.ts`); the adapter never
 * touches that file, which also holds the account.
 */

import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { ActionList, BackendCallResult, McpServersOp, Rejected } from "../../../contract";
import type { OpsDeps } from "../ports";
import { isRejected, rejected } from "../rejections";
import { guarded } from "./guard";
import { messageOf } from "./host-access";
import { actionList, findAction } from "./list-rows";
import { mcpRow } from "./mcp-rows";

async function listOf(query: Query, note?: string): Promise<ActionList> {
	return actionList((await query.mcpServerStatus()).map(mcpRow), note);
}

async function take(query: Query, name: string, actionId: string): Promise<{ note: string } | Rejected> {
	try {
		if (actionId === "reconnect") {
			await query.reconnectMcpServer(name);
			return { note: `Reconnecting ${name}.` };
		}
		const enable = actionId === "enable";
		await query.toggleMcpServer(name, enable);
		return { note: `${name} ${enable ? "enabled" : "disabled"} for this project.` };
	} catch (error) {
		return rejected("backend_error", `${actionId} ${name}: ${messageOf(error)}`);
	}
}

export async function mcpServers(deps: OpsDeps, op: McpServersOp): Promise<BackendCallResult> {
	return guarded("mcp_servers", async () => {
		const result = await deps.live.withHost(op.sessionId, async ({ query }) => {
			if (op.change === undefined) return { kind: "mcp_servers" as const, list: await listOf(query) };
			const found = findAction(actionList((await query.mcpServerStatus()).map(mcpRow)).rows, op.change);
			if (isRejected(found)) return found;
			const taken = await take(query, found.row.id, found.action.id);
			if (isRejected(taken)) return taken;
			return { kind: "mcp_servers" as const, list: await listOf(query, taken.note) };
		});
		return result;
	});
}
