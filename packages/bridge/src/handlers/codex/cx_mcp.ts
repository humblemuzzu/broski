/**
 * Codex MCP + review handler.
 * Extracted from server.ts — cases: cx_mcp_status_list, cx_mcp_reload, cx_review_start
 */

import type { CodexAppServerClient } from "../../connectors/codex";
import type { CodexThread } from "../../types";

export type CxMcpHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
	cxThreadOwners: Map<string, any>;
	cxThreadCwds: Map<string, string>;
	cxActiveTurns: Map<string, string>;
	mapCodexThread: (thread: any, nameOverride?: string) => CodexThread & { threadName?: string };
	ws: any;
};

export async function handleCxMcp(message: any, reply: (msg: any) => void, ctx: CxMcpHandlerContext): Promise<boolean> {
	const { ensureCodexClient, safeString, cxThreadOwners, cxThreadCwds, cxActiveTurns, mapCodexThread, ws } = ctx;

	switch (message.type) {
		case "cx_mcp_status_list": {
			const client = await ensureCodexClient();
			const result: any = await client.request("mcpServerStatus/list", {
				cursor: message.cursor ?? null,
				limit: message.limit ?? 200,
			});
			reply({
				type: "cx_mcp_status",
				data: result?.data ?? [],
				nextCursor: result?.nextCursor ?? null,
				requestId: message.requestId,
			});
			return true;
		}
		// Codex MCP Hot Reload (SDK feature) - reloads MCP server config without restarting
		case "cx_mcp_reload": {
			const client = await ensureCodexClient();
			// Protocol expects params to be omitted (Option<()>).
			const result: any = await client.request("config/mcpServer/reload");
			reply({ type: "cx_mcp_reloaded", data: result ?? {}, requestId: message.requestId });
			return true;
		}
		case "cx_review_start": {
			const client = await ensureCodexClient();
			const explicitCwd = safeString(message.cwd).trim();

			let threadId = message.threadId;
			const storedCwd = threadId ? cxThreadCwds.get(threadId) : null;
			if (storedCwd && explicitCwd && storedCwd !== explicitCwd) {
				reply({ type: "error", message: "Access denied", requestId: message.requestId });
				return true;
			}
			const cwd = explicitCwd || storedCwd || "";
			if (!cwd) {
				reply({ type: "error", message: "Missing cwd", requestId: message.requestId });
				return true;
			}
			if (!threadId) {
				const startRes: any = await client.request("thread/start", {
					cwd,
					model: message.model ?? null,
					approvalPolicy: message.approvalPolicy ?? null,
					sandbox: message.sandbox ?? null,
					config: message.config ?? null,
				});
				threadId = safeString(startRes?.thread?.id);
				if (threadId) {
					reply({
						type: "cx_thread_created",
						data: mapCodexThread(startRes.thread),
						requestId: message.requestId,
					});
					cxThreadCwds.set(threadId, cwd);
				}
			} else {
				const personalityReview = safeString(message.personality).trim().toLowerCase();
				const personalityReviewVal =
					personalityReview === "none" || personalityReview === "friendly" || personalityReview === "pragmatic"
						? personalityReview
						: null;
				await client.request("thread/resume", {
					threadId,
					model: message.model ?? null,
					cwd,
					approvalPolicy: message.approvalPolicy ?? null,
					sandbox: message.sandbox ?? null,
					config: message.config ?? null,
					...(personalityReviewVal ? { personality: personalityReviewVal } : {}),
				});
			}

			if (!threadId) {
				reply({
					type: "error",
					message: "Failed to create/resume Codex thread for review",
					requestId: message.requestId,
				});
				return true;
			}

			cxThreadOwners.set(threadId, ws);

			const target = message.target ?? { type: "uncommittedChanges" };
			const delivery = message.delivery ?? "inline";
			// EXPERIMENTAL: `review/start` is not part of the confirmed public Codex API surface.
			// Keep this feature behind UI affordances that can be removed if the endpoint disappears.
			const res: any = await client.request("review/start", {
				threadId,
				target,
				delivery,
			});
			const reviewThreadId = safeString(res?.reviewThreadId ?? res?.review_thread_id) || threadId;
			const turnId = safeString(res?.turn?.id);
			if (reviewThreadId) cxThreadOwners.set(reviewThreadId, ws);
			if (turnId && reviewThreadId) cxActiveTurns.set(reviewThreadId, turnId);
			reply({
				type: "cx_review_started",
				data: { threadId, reviewThreadId, turnId },
				requestId: message.requestId,
			});
			return true;
		}
		default:
			return false;
	}
}
