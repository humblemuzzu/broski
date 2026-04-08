/**
 * Unified handler for listing child/subagent sessions across all backends.
 *
 * Message: unified_list_session_children
 *   { backend, sessionId, cwd? }
 * Response: unified_session_children
 *   { backend, data: BroskiSessionSummary[], requestId? }
 */

import type { BroskiBackend, BroskiSessionSummary } from "../types/runtime";
import { mapOpenCodeSessionToRuntimeSession } from "../runtime/opencode-runtime-read-models";
import { mapClaudeCodeSessionToRuntimeSession } from "../runtime/claude-code-runtime-read-models";
import { mapPiSessionToRuntimeSession } from "../runtime/pi-runtime-read-models";
import { mapCodexThreadToRuntimeSession } from "../runtime/codex-runtime-read-models";

type Reply = (msg: any) => void;

export type SessionChildrenContext = {
	requireOpenCode: () => {
		listSessionChildren: (sessionId: string, dir?: string) => Promise<any[]>;
	} | null;
	claudeCode: {
		listSubagents: (sessionId: string, cwd?: string) => Promise<string[]>;
		getSubagentMessages: (sessionId: string, agentId: string, cwd?: string) => Promise<any[]>;
	};
	ensureCodexClient: () => Promise<{
		request: (method: string, params: any) => Promise<any>;
	}>;
	log: (...args: any[]) => void;
};

export async function handle(message: any, reply: Reply, ctx: SessionChildrenContext): Promise<boolean> {
	switch (message.type) {
		case "unified_list_session_children": {
			const backend: BroskiBackend = message.backend;
			const sessionId: string = message.sessionId;
			let data: BroskiSessionSummary[] = [];

			switch (backend) {
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						if (oc) {
							const children = await oc.listSessionChildren(sessionId, message.cwd);
							data = children.map(mapOpenCodeSessionToRuntimeSession);
						}
					} catch (e) {
						ctx.log("[unified_session_children] OC error:", e);
						data = [];
					}
					break;
				}

				case "claude-code": {
					try {
						const agentIds = await ctx.claudeCode.listSubagents(sessionId, message.cwd);
						// Build a minimal summary for each subagent
						data = agentIds.map((agentId) => ({
							id: `${sessionId}::${agentId}`,
							backend: "claude-code" as const,
							title: agentId,
							cwd: message.cwd ?? "",
							createdAtMs: 0,
							updatedAtMs: 0,
							parentSessionId: sessionId,
							sessionKind: "subagent" as const,
							subagentType: agentId,
							backendData: {
								parentSessionId: sessionId,
								agentId,
							},
						}));
					} catch (e) {
						ctx.log("[unified_session_children] CC error:", e);
						data = [];
					}
					break;
				}

				case "codex": {
					// Codex doesn't have a direct "list children of thread" RPC.
					// We list all threads and filter by forkedFromId or agentNickname matching.
					try {
						const client = await ctx.ensureCodexClient();
						const result: any = await client.request("thread/list", {
							limit: 200,
						});
						const threads: any[] = result?.data ?? [];
						// Find threads that are children of this session (forked from it or collab agents)
						const children = threads.filter(
							(t: any) => t.forkedFromId === sessionId || t.parentThreadId === sessionId,
						);
						data = children.map((t: any) => mapCodexThreadToRuntimeSession(t));
					} catch (e) {
						ctx.log("[unified_session_children] CX error:", e);
						data = [];
					}
					break;
				}

				case "pi": {
					try {
						const piMod = await import("../connectors/pi");
						const allSessions = await piMod.listSessions(message.cwd);
						// Find sessions whose parentSessionPath matches this session's path
						const parentSession = allSessions.find((s: any) => s.id === sessionId);
						if (parentSession) {
							const children = allSessions.filter(
								(s: any) => s.parentSessionPath === parentSession.path,
							);
							data = children.map((s: any) => mapPiSessionToRuntimeSession(s, allSessions));
						}
					} catch (e) {
						ctx.log("[unified_session_children] Pi error:", e);
						data = [];
					}
					break;
				}
			}

			reply({ type: "unified_session_children", backend, data, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
