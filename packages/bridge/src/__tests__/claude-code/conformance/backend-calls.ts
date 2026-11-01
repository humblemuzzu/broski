/**
 * A valid call of each Claude Code op against a session with history (rules 9 and 30). File and tool ids come from the
 * adapter's own listings, never from the fake's (`example-ops.ts`), since an id the backend never named is `not_found`.
 */

import type { AgentBackend, BackendCall, BackendOpKind, ClaudeCodeOp, SessionRef } from "../../../contract";

export async function claudeCodeCall(
	backend: AgentBackend,
	session: SessionRef,
	op: BackendOpKind,
	cwd: string,
): Promise<BackendCall | undefined> {
	const { sessionId } = session;
	const call = (made: ClaudeCodeOp): BackendCall => ({ backend: "claude-code", op: made });
	switch (op) {
		case "session_settings":
		case "changed_files":
		case "mcp_servers":
		case "tasks":
		case "context_usage":
			return call({ kind: op, sessionId });
		case "refresh_models":
		case "custom_tools":
			return call({ kind: op });
		case "config_files":
		case "settings_overview":
			return call({ kind: op, cwd });
		case "plugins":
			return call({ kind: op, cwd, sessionId });
		case "rewind_files": {
			const userItemId = await firstPromptId(backend, session);
			return userItemId === undefined ? undefined : call({ kind: op, sessionId, userItemId, dryRun: true });
		}
		case "config_file": {
			const fileId = await listedConfigFile(backend, cwd);
			return fileId === undefined ? undefined : call({ kind: op, cwd, fileId });
		}
		case "custom_tool": {
			const toolId = await listedCustomTool(backend);
			return call(toolId === undefined ? { kind: op } : { kind: op, toolId });
		}
		default:
			return undefined;
	}
}

async function firstPromptId(backend: AgentBackend, session: SessionRef): Promise<string | undefined> {
	const read = await backend.readTranscript(session, { limit: 200 });
	if (read.status === "rejected") return undefined;
	return read.page.items.findLast((item) => item.kind === "user_message")?.id;
}

/** An existing, editable JSON file when there is one (the world writes `<cwd>/.claude/settings.json`). */
async function listedConfigFile(backend: AgentBackend, cwd: string): Promise<string | undefined> {
	const listed = await backend.call?.({ backend: "claude-code", op: { kind: "config_files", cwd } });
	if (listed?.status !== "accepted" || listed.result.kind !== "config_files") return undefined;
	const files = listed.result.files.filter((file) => !file.template);
	const best = files.find((file) => file.exists && file.editable && file.format === "json") ?? files[0];
	return best?.id;
}

async function listedCustomTool(backend: AgentBackend): Promise<string | undefined> {
	const listed = await backend.call?.({ backend: "claude-code", op: { kind: "custom_tools" } });
	if (listed?.status !== "accepted" || listed.result.kind !== "custom_tools") return undefined;
	return listed.result.list.rows[0]?.id;
}
