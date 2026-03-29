/**
 * Codex app-server handler for NEW features (mid-2026 SDK update):
 *   - turn/steer (nudge agent mid-turn)
 *   - thread/name/set (rename thread)
 *   - thread/unarchive
 *   - thread/compact/start
 *   - skills/remote/list + skills/remote/export
 *   - skills/config/write (enable/disable individual skills)
 *   - app/list (apps marketplace)
 *   - command/exec (one-off command)
 *   - experimentalFeature/list
 *
 * Each case is a thin adapter: validate → call JSON-RPC → reply.
 */

import type { CodexAppServerClient } from "../connectors/codex";

// Minimal context the handler needs from the outer server.
export type CodexHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	cxActiveTurns: Map<string, string>;
	cxThreadNames: Map<string, string>;
	safeString: (v: unknown) => string;
};

/**
 * Returns true if this handler processed the message, false otherwise.
 * Caller should check the return value and fall through to the next handler if false.
 */
export async function handleCodexFeature(
	message: any,
	reply: (msg: any) => void,
	ctx: CodexHandlerContext,
): Promise<boolean> {
	const { ensureCodexClient, cxActiveTurns, cxThreadNames, safeString } = ctx;

	switch (message.type) {
		// ── turn/steer ────────────────────────────────────────────────────
		case "cx_steer": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			const prompt = safeString(message.prompt).trim();
			if (!threadId || !prompt) {
				reply({
					type: "error",
					message: "cx_steer requires threadId and prompt",
				});
				break;
			}
			// expectedTurnId is required by SDK (TurnSteerParams)
			const expectedTurnId = safeString(message.turnId).trim() || cxActiveTurns.get(threadId) || "";
			if (!expectedTurnId) {
				reply({
					type: "error",
					message: "cx_steer requires an active turn (no turnId found)",
				});
				break;
			}
			// SDK UserInput type: { type: "text", text, text_elements }
			const result = await client.request("turn/steer", {
				threadId,
				input: [{ type: "text", text: prompt, text_elements: [] }],
				expectedTurnId,
			});
			reply({ type: "cx_steered", data: result ?? { ok: true } });
			break;
		}

		// ── thread/name/set ──────────────────────────────────────────────
		case "cx_thread_rename": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			const name = safeString(message.name).trim();
			if (!threadId || !name) {
				reply({
					type: "error",
					message: "cx_thread_rename requires threadId and name",
				});
				break;
			}
			const result = await client.request("thread/name/set", {
				threadId,
				name,
			});
			// Eagerly update the local name cache (thread/name/updated notification will also fire)
			cxThreadNames.set(threadId, name);
			reply({ type: "cx_thread_renamed", data: result ?? { ok: true } });
			break;
		}

		// ── thread/unarchive ─────────────────────────────────────────────
		// Protocol: ThreadUnarchiveResponse = { thread: Thread }
		case "cx_thread_unarchive": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({
					type: "error",
					message: "cx_thread_unarchive requires threadId",
				});
				break;
			}
			const result: any = await client.request("thread/unarchive", {
				threadId,
			});
			// Unwrap: protocol returns { thread: Thread }, normalize to just the Thread object
			reply({
				type: "cx_thread_unarchived",
				data: result?.thread ?? result ?? {},
			});
			break;
		}

		// ── thread/compact/start ─────────────────────────────────────────
		case "cx_thread_compact": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({
					type: "error",
					message: "cx_thread_compact requires threadId",
				});
				break;
			}
			const result = await client.request("thread/compact/start", { threadId });
			reply({ type: "cx_thread_compacted", data: result ?? { ok: true } });
			break;
		}

		// ── skills/remote/list ───────────────────────────────────────────
		case "cx_remote_skills_list": {
			const client = await ensureCodexClient();
			const hazelnutScope = safeString(message.hazelnutScope).trim() || "all-shared";
			const productSurface = safeString(message.productSurface).trim() || "codex";
			const enabled = message.enabled !== false;
			const result: any = await client.request("skills/remote/list", {
				hazelnutScope,
				productSurface,
				enabled,
			});
			reply({ type: "cx_remote_skills", data: result?.data ?? [] });
			break;
		}

		// ── skills/remote/export (install) ───────────────────────────────
		case "cx_remote_skill_install": {
			const client = await ensureCodexClient();
			const hazelnutId = safeString(message.hazelnutId).trim();
			if (!hazelnutId) {
				reply({
					type: "error",
					message: "cx_remote_skill_install requires hazelnutId",
				});
				break;
			}
			const result = await client.request("skills/remote/export", {
				hazelnutId,
			});
			reply({
				type: "cx_remote_skill_installed",
				data: result ?? { ok: true },
			});
			break;
		}

		// ── skills/config/write (enable/disable per skill) ───────────────
		case "cx_skill_config_write": {
			const client = await ensureCodexClient();
			const path = safeString(message.path).trim();
			const enabled = message.enabled === true;
			if (!path) {
				reply({
					type: "error",
					message: "cx_skill_config_write requires path",
				});
				break;
			}
			const result = await client.request("skills/config/write", {
				path,
				enabled,
			});
			reply({ type: "cx_skill_config_written", data: result ?? { ok: true } });
			break;
		}

		// ── app/list ─────────────────────────────────────────────────────
		// Protocol: AppsListParams = { cursor?, limit?, threadId?, forceRefetch? }
		case "cx_apps_list": {
			const client = await ensureCodexClient();
			const cursor = message.cursor ?? null;
			const limit = message.limit ?? null;
			const threadId = message.threadId ? safeString(message.threadId).trim() : null;
			const forceRefetch = message.forceRefetch === true;
			const result: any = await client.request("app/list", {
				...(cursor ? { cursor } : {}),
				...(limit ? { limit } : {}),
				...(threadId ? { threadId } : {}),
				...(forceRefetch ? { forceRefetch } : {}),
			});
			reply({
				type: "cx_apps",
				data: result?.data ?? [],
				nextCursor: result?.nextCursor ?? null,
			});
			break;
		}

		// ── command/exec ─────────────────────────────────────────────────
		// Protocol: CommandExecParams = { command: string[], timeoutMs?, cwd?, sandboxPolicy? }
		// SandboxPolicy = "dangerFullAccess" | { type: "readOnly", ... } | { type: "workspaceWrite", ... } | ...
		case "cx_command_exec": {
			const client = await ensureCodexClient();
			const command = message.command as string[] | undefined;
			if (!command || !Array.isArray(command) || command.length === 0) {
				reply({
					type: "error",
					message: "cx_command_exec requires command array",
				});
				break;
			}
			const result = await client.request("command/exec", {
				command,
				...(message.timeoutMs ? { timeoutMs: message.timeoutMs } : {}),
				...(message.cwd ? { cwd: message.cwd } : {}),
				...(message.sandboxPolicy ? { sandboxPolicy: message.sandboxPolicy } : {}),
			});
			reply({ type: "cx_command_result", data: result ?? {} });
			break;
		}

		// ── experimentalFeature/list ─────────────────────────────────────
		case "cx_experimental_features": {
			const client = await ensureCodexClient();
			const cursor = message.cursor ?? null;
			const limit = message.limit ?? null;
			const result: any = await client.request("experimentalFeature/list", {
				...(cursor ? { cursor } : {}),
				...(limit ? { limit } : {}),
			});
			reply({
				type: "cx_experimental_features_list",
				data: result?.data ?? [],
				nextCursor: result?.nextCursor ?? null,
			});
			break;
		}

		// ── #21: config/batchWrite ─────────────────────────────────────────
		case "cx_config_batch_write": {
			const client = await ensureCodexClient();
			const edits = message.edits as Array<{ keyPath: string; value: any; mergeStrategy?: string }> | undefined;
			if (!edits || !Array.isArray(edits) || edits.length === 0) {
				reply({
					type: "error",
					message: "cx_config_batch_write requires edits array",
				});
				break;
			}
			const result = await client.request("config/batchWrite", {
				edits: edits.map((e: any) => ({
					keyPath: e.keyPath,
					value: e.value,
					mergeStrategy: e.mergeStrategy ?? "replace",
				})),
				...(message.filePath ? { filePath: message.filePath } : {}),
				...(message.expectedVersion ? { expectedVersion: message.expectedVersion } : {}),
			});
			reply({ type: "cx_config_batch_written", data: result ?? { ok: true } });
			break;
		}

		// ── #22: configRequirements/read ─────────────────────────────────
		case "cx_config_requirements_read": {
			const client = await ensureCodexClient();
			const result = await client.request("configRequirements/read");
			reply({ type: "cx_config_requirements", data: result ?? {} });
			break;
		}

		// ── #23: thread/loaded/list ──────────────────────────────────────
		case "cx_thread_loaded_list": {
			const client = await ensureCodexClient();
			const cursor = message.cursor ?? null;
			const limit = message.limit ?? null;
			const result: any = await client.request("thread/loaded/list", {
				...(cursor ? { cursor } : {}),
				...(limit ? { limit } : {}),
			});
			reply({
				type: "cx_thread_loaded_list",
				data: result?.data ?? [],
				nextCursor: result?.nextCursor ?? null,
			});
			break;
		}

		// ── #24: thread/read ─────────────────────────────────────────────
		// Protocol: ThreadReadResponse = { thread: Thread }
		case "cx_thread_read": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({ type: "error", message: "cx_thread_read requires threadId" });
				break;
			}
			const result: any = await client.request("thread/read", {
				threadId,
				includeTurns: message.includeTurns === true,
			});
			// Unwrap: protocol returns { thread: Thread }, normalize to just the Thread object
			reply({ type: "cx_thread_detail", data: result?.thread ?? result ?? {} });
			break;
		}

		// ── #25: mcpServer/oauth/login ───────────────────────────────────
		case "cx_mcp_oauth_login": {
			const client = await ensureCodexClient();
			const name = safeString(message.name).trim();
			if (!name) {
				reply({ type: "error", message: "cx_mcp_oauth_login requires name" });
				break;
			}
			const result: any = await client.request("mcpServer/oauth/login", {
				name,
				...(message.scopes ? { scopes: message.scopes } : {}),
				...(message.timeoutSecs ? { timeoutSecs: message.timeoutSecs } : {}),
			});
			reply({
				type: "cx_mcp_oauth_login_started",
				data: { authorizationUrl: result?.authorizationUrl ?? "" },
				name,
			});
			break;
		}

		// ── thread/unsubscribe ───────────────────────────────────────────
		case "cx_thread_unsubscribe": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({
					type: "error",
					message: "cx_thread_unsubscribe requires threadId",
				});
				break;
			}
			const result: any = await client.request("thread/unsubscribe", {
				threadId,
			});
			reply({
				type: "cx_thread_unsubscribed",
				data: result ?? { status: "unsubscribed" },
			});
			break;
		}

		// ── collaborationMode/list ───────────────────────────────────────
		case "cx_collaboration_modes": {
			const client = await ensureCodexClient();
			const result: any = await client.request("collaborationMode/list", {
				...(message.threadId ? { threadId: message.threadId } : {}),
			});
			reply({
				type: "cx_collaboration_modes_list",
				data: result?.data ?? result?.modes ?? [],
			});
			break;
		}

		// ── thread/backgroundTerminals/clean ─────────────────────────────
		case "cx_background_terminals_clean": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			if (!threadId) {
				reply({
					type: "error",
					message: "cx_background_terminals_clean requires threadId",
				});
				break;
			}
			const result = await client.request("thread/backgroundTerminals/clean", {
				threadId,
			});
			reply({
				type: "cx_background_terminals_cleaned",
				data: result ?? { ok: true },
			});
			break;
		}

		// ── thread/shellCommand ──────────────────────────────────────────
		case "cx_shell_command": {
			const client = await ensureCodexClient();
			const threadId = safeString(message.threadId).trim();
			const command = safeString(message.command).trim();
			if (!threadId || !command) {
				reply({ type: "error", message: "cx_shell_command requires threadId and command" });
				break;
			}
			const result = await client.request("thread/shellCommand", { threadId, command });
			reply({ type: "cx_shell_command_started", data: result ?? { ok: true } });
			break;
		}

		default:
			return false; // Not handled by this module
	}

	return true; // Handled
}
