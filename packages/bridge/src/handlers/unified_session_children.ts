/**
 * Unified handler for listing child/subagent sessions across all backends.
 *
 * Message: unified_list_session_children
 *   { backend, sessionId, cwd? }
 * Response: unified_session_children
 *   { backend, data: BroskiSessionSummary[], requestId? }
 */

import type { BroskiBackend, BroskiSessionSummary } from "../types/runtime";
import { getCollabChildren } from "../connectors/codex/cx-collab-cache";
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
						// Build summaries with real data from subagent messages
						const summaries: BroskiSessionSummary[] = [];
						for (const agentId of agentIds) {
							try {
								// SessionMessage has: { type, uuid, session_id, message, parent_tool_use_id }
								const msgs = await ctx.claudeCode.getSubagentMessages(sessionId, agentId, message.cwd);
								// Extract title from first user message content
								let title = agentId;
								for (const m of msgs) {
									if (m.type === "user") {
										const msg = m.message;
										// message can be string or { content: [...] }
										const text = typeof msg === "string"
											? msg
											: Array.isArray((msg as any)?.content)
												? (msg as any).content.find((b: any) => b?.type === "text")?.text ?? ""
												: "";
										if (text.trim()) {
											title = text.trim().slice(0, 80);
											break;
										}
									}
								}
								summaries.push({
									id: agentId,
									backend: "claude-code",
									title,
									cwd: message.cwd ?? "",
									createdAtMs: 0, // SDK SessionMessage has no timestamp
									updatedAtMs: 0,
									parentSessionId: sessionId,
									sessionKind: "subagent",
									subagentType: agentId.replace(/^agent-/, "").slice(0, 12),
									backendData: {
										parentSessionId: sessionId,
										agentId,
										messageCount: msgs.length,
									},
								});
							} catch {
								// Fallback for agents whose messages can't be read
								summaries.push({
									id: agentId,
									backend: "claude-code",
									title: agentId,
									cwd: message.cwd ?? "",
									createdAtMs: 0,
									updatedAtMs: 0,
									parentSessionId: sessionId,
									sessionKind: "subagent",
									subagentType: agentId.replace(/^agent-/, "").slice(0, 12),
									backendData: { parentSessionId: sessionId, agentId },
								});
							}
						}
						data = summaries;
					} catch (e) {
						ctx.log("[unified_session_children] CC error:", e);
						data = [];
					}
					break;
				}

				case "codex": {
					// Check both forks (forkedFromId) and collab cache for parent-child links.
					try {
						const client = await ctx.ensureCodexClient();
						const result: any = await client.request("thread/list", {
							limit: 200,
						});
						const threads: any[] = result?.data ?? [];

						// Forks: explicit parent link in DB
						const forkChildren = threads.filter(
							(t: any) => t.forkedFromId === sessionId,
						);

						// Collab children: look up from persisted cache
						const collabChildIds = new Set(
							getCollabChildren(sessionId).map((r) => r.childThreadId),
						);
						const collabChildren = threads.filter(
							(t: any) => collabChildIds.has(t.id) && t.forkedFromId !== sessionId,
						);

						data = [...forkChildren, ...collabChildren].map((t: any) =>
							mapCodexThreadToRuntimeSession(t),
						);
					} catch (e) {
						ctx.log("[unified_session_children] CX error:", e);
						data = [];
					}
					break;
				}

				case "pi": {
					try {
						const piMod = await import("../connectors/pi");
						const { extractSubagentInvocations, mapInvocationsToSummaries } = await import(
							"../connectors/pi/pi-subagent-extraction"
						);
						const allSessions = await piMod.listSessions(message.cwd);
						const parentSession = allSessions.find((s: any) => s.id === sessionId);
						if (parentSession) {
							// Handoff/fork children (real sessions with parentSessionPath)
							const handoffChildren = allSessions
								.filter((s: any) => s.parentSessionPath === parentSession.path)
								.map((s: any) => mapPiSessionToRuntimeSession(s, allSessions));

							// Tool-based subagent invocations (Task, oracle, finder, etc.)
							const invocations = await extractSubagentInvocations(parentSession.path);
							const toolChildren = mapInvocationsToSummaries(
								invocations,
								sessionId,
								parentSession.cwd,
							);

							data = [...handoffChildren, ...toolChildren];
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
