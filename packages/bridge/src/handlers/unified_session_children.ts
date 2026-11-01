/**
 * Unified handler for listing child/subagent sessions.
 *
 * Message: unified_list_session_children
 *   { backend, sessionId, cwd? }
 * Response: unified_session_children
 *   { backend, data: BroskiSessionSummary[], requestId? }
 */

import type { UnifiedMessage } from "../routing/messages";
import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import type { BroskiBackend, BroskiSessionSummary } from "../types/runtime";

type Reply = (msg: any) => void;

export type SessionChildrenContext = {
	claudeCode: {
		listSubagents: (sessionId: string, cwd?: string) => Promise<string[]>;
		getSubagentMessages: (sessionId: string, agentId: string, cwd?: string) => Promise<any[]>;
	};
	log: (...args: any[]) => void;
};

const CHILDREN_OPS = ["unified_list_session_children"] as const;

export const MODULE_TYPES = CHILDREN_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerAll(router, CHILDREN_OPS, async (message, c) => {
		const children = await deps.getClaudeCodeChildren();
		await handle(message, c.reply, {
			claudeCode: children,
			log: deps.logInfo,
		});
	});
}

export async function handle(message: UnifiedMessage, reply: Reply, ctx: SessionChildrenContext): Promise<boolean> {
	switch (message.type) {
		case "unified_list_session_children": {
			const backend: BroskiBackend = message.backend;
			const sessionId: string = message.sessionId;
			let data: BroskiSessionSummary[] = [];

			switch (backend) {
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
										const text =
											typeof msg === "string"
												? msg
												: Array.isArray((msg as any)?.content)
													? ((msg as any).content.find((b: any) => b?.type === "text")?.text ?? "")
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
			}

			reply({ type: "unified_session_children", backend, data, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
