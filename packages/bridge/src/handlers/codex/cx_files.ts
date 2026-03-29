/**
 * Codex files handler.
 * Extracted from server.ts — cases: cx_undo_files, cx_get_thread_messages
 */

import type { CodexAppServerClient } from "../../connectors/codex";

export type CxFilesHandlerContext = {
	safeString: (v: unknown) => string;
	logInfo: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
	codexFs: {
		getThreadMessagesFromFs: (threadId: string) => Promise<any[]>;
	};
	codexClient: CodexAppServerClient | null;
	ensureUndoStack: (threadId: string) => string[];
	applyCodexUndo: (threadId: string, key: string) => Promise<string[]>;
};

/**
 * Convert Codex thread/read turn items into the transcript format the Flutter app expects.
 * This handles fresh/active threads where the JSONL file hasn't been flushed yet.
 */
function turnsToTranscript(turns: any[]): any[] {
	const out: any[] = [];
	let seq = 0;
	const baseTime = Math.floor(Date.now() / 1000) - turns.length * 10;

	for (const turn of turns) {
		const items: any[] = turn?.items ?? turn?.threadItems ?? [];
		for (const item of items) {
			const itemType = typeof item?.type === "string" ? item.type : "";
			switch (itemType) {
				case "userMessage": {
					const content: any[] = item?.content ?? [];
					const textParts = content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "");
					const text = textParts.join("\n").trim();
					if (text) {
						out.push({
							id: item.id ?? `user_${baseTime}_${seq}`,
							role: "user",
							createdAt: baseTime + seq,
							text,
						});
						seq++;
					}
					break;
				}
				case "agentMessage": {
					const text = typeof item?.text === "string" ? item.text : "";
					if (text) {
						out.push({
							id: item.id ?? `assistant_${baseTime}_${seq}`,
							role: "assistant",
							createdAt: baseTime + seq,
							text,
						});
						seq++;
					}
					break;
				}
				case "commandExecution": {
					// Tool call — add to last assistant or create new one
					let last = out.length > 0 ? out[out.length - 1] : null;
					if (!last || last.role !== "assistant") {
						last = {
							id: `assistant_${baseTime}_${seq}`,
							role: "assistant",
							createdAt: baseTime + seq,
							text: "",
							toolCalls: [],
						};
						out.push(last);
						seq++;
					}
					if (!last.toolCalls) last.toolCalls = [];
					last.toolCalls.push({
						name: "Bash",
						input: item?.command ?? "",
						output: item?.aggregatedOutput ?? item?.output ?? "",
						status: item?.status ?? "completed",
					});
					break;
				}
				case "fileChange": {
					let last = out.length > 0 ? out[out.length - 1] : null;
					if (!last || last.role !== "assistant") {
						last = {
							id: `assistant_${baseTime}_${seq}`,
							role: "assistant",
							createdAt: baseTime + seq,
							text: "",
							toolCalls: [],
						};
						out.push(last);
						seq++;
					}
					if (!last.toolCalls) last.toolCalls = [];
					last.toolCalls.push({
						name: "ApplyPatch",
						input: item?.changes ?? "",
						output: item?.aggregatedOutput ?? "",
						status: item?.status ?? "completed",
					});
					break;
				}
				// Skip other item types (hookPrompt, plan, reasoning, etc.) — they're not user-visible messages
			}
		}
	}
	return out;
}

export async function handleCxFiles(
	message: any,
	reply: (msg: any) => void,
	ctx: CxFilesHandlerContext,
): Promise<boolean> {
	const { safeString, logInfo, logError, codexFs, ensureUndoStack, applyCodexUndo } = ctx;

	switch (message.type) {
		case "cx_get_thread_messages": {
			// Priority order:
			// 1. RPC (when app-server is running — authoritative, instant, avoids SQLite lock contention)
			// 2. Filesystem (when app-server is NOT running — reads JSONL rollout files)
			//
			// Previous approach tried filesystem first, but when the app-server is running
			// it often holds an exclusive lock on state_5.sqlite. The SQLite rollout_path
			// lookup fails, triggering a slow scan of ALL ~1000+ session files. With
			// concurrent prefetch requests this caused multi-minute hangs.

			const threadId = message.threadId as string;

			// ── Tier 1: RPC (preferred when app-server is live) ──
			if (ctx.codexClient?.isRunning) {
				try {
					logInfo(`[cx_get_thread_messages] Fetching thread ${threadId} via thread/read RPC...`);
					const result: any = await ctx.codexClient.request("thread/read", {
						threadId,
						includeTurns: true,
					});
					const turns: any[] = result?.thread?.turns ?? [];
					if (turns.length > 0) {
						const rpcTranscript = turnsToTranscript(turns);
						logInfo(`[cx_get_thread_messages] Got ${rpcTranscript.length} messages via RPC`);
						reply({
							type: "cx_thread_messages",
							data: rpcTranscript,
							threadId,
							requestId: message.requestId,
						});
						return true;
					}
					logInfo(`[cx_get_thread_messages] RPC returned 0 turns, trying filesystem...`);
				} catch (rpcErr: any) {
					logError(`[cx_get_thread_messages] RPC failed, falling back to filesystem:`, rpcErr?.message ?? rpcErr);
				}
			}

			// ── Tier 2: Filesystem (offline or RPC returned nothing) ──
			try {
				logInfo(`[cx_get_thread_messages] Reading thread ${threadId} from filesystem...`);
				const transcript = await codexFs.getThreadMessagesFromFs(threadId);
				if (transcript.length > 0) {
					logInfo(`[cx_get_thread_messages] Found ${transcript.length} messages from filesystem`);
					reply({
						type: "cx_thread_messages",
						data: transcript,
						threadId,
						requestId: message.requestId,
					});
					return true;
				}
			} catch (fsErr: any) {
				logError(`[cx_get_thread_messages] Filesystem read failed:`, fsErr?.message ?? fsErr);
			}

			// No messages from either source
			logInfo(`[cx_get_thread_messages] No messages found for thread ${threadId}`);
			reply({
				type: "cx_thread_messages",
				data: [],
				threadId,
				requestId: message.requestId,
			});
			return true;
		}
		case "cx_undo_files": {
			const threadId = safeString(message.threadId);
			if (!threadId) {
				reply({
					type: "cx_undo_result",
					data: { ok: false, revertedPaths: [], error: "Missing threadId" },
					requestId: message.requestId,
				});
				return true;
			}
			const stack = ensureUndoStack(threadId);
			const count = Math.max(1, Number(message.count ?? 1) || 1);
			if (stack.length === 0) {
				reply({
					type: "cx_undo_result",
					data: { ok: true, revertedPaths: [] },
					requestId: message.requestId,
				});
				return true;
			}
			const keys = stack.slice(-count);
			const revertedAll: string[] = [];
			try {
				for (const key of keys.reverse()) {
					const reverted = await applyCodexUndo(threadId, key);
					revertedAll.push(...reverted);
				}
				reply({
					type: "cx_undo_result",
					data: { ok: true, revertedPaths: revertedAll },
					requestId: message.requestId,
				});
			} catch (err: any) {
				reply({
					type: "cx_undo_result",
					data: {
						ok: false,
						revertedPaths: revertedAll,
						error: err?.message ?? String(err),
					},
					requestId: message.requestId,
				});
			}
			return true;
		}
		default:
			return false;
	}
}
