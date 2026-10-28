import type { CodexNotification } from "../connectors/codex";
import { extractCodexErrorDetails } from "../handlers/codex/cx_error_extract";
import { handleCodexRuntimeNotification } from "../handlers/codex/runtime-notifications";
import { buildCodexRuntimeState } from "../runtime/codex-runtime-read-models";
import type { ServerMessage } from "../types";
import type { CodexFileUndo } from "./codex-file-undo";
import type { LeveledLogger } from "./logger";
import type { Sessions } from "./sessions";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

const CX_ITEM_CACHE_MAX = 5000; // Prevent unbounded growth of Codex item cache
const CX_ITEM_CACHE_PRUNE = 1000; // Evict oldest 20% on overflow

export type CodexNotificationDeps = {
	state: BridgeState;
	streams: Streams;
	sessions: Sessions;
	fileUndo: CodexFileUndo;
	log: LeveledLogger;
	getSecurePath: (path: string) => Promise<string | null>;
};

/** The bridge's reaction to a Codex app-server notification. */
export function createCodexNotificationHandler(deps: CodexNotificationDeps): (n: CodexNotification) => void {
	const { state, streams, sessions, fileUndo } = deps;

	return (n: CodexNotification): void => {
		const params: any = n.params ?? {};
		// Codex app-server protocol places threadId in different locations by notification type
		let threadId = safeString(params.threadId ?? params.thread_id ?? params.threadID);
		const turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID);

		if (n.method === "thread/started") {
			const thread = params.thread;
			const id = safeString(thread?.id);
			const cwd = safeString(thread?.cwd);
			if (id && cwd) {
				void deps
					.getSecurePath(cwd)
					.then((secure) => {
						if (secure) state.cxThreadCwds.set(id, secure);
					})
					.catch(() => {});
			}
			if (id && !threadId) threadId = id;
		}

		// #19: Forward app/list/updated notification to all clients
		if (n.method === "app/list/updated") {
			const appData = params.data ?? params;
			for (const ws of state.sockets) {
				streams.send(ws, {
					type: "cx_apps_updated",
					data: Array.isArray(appData) ? appData : [],
				});
			}
		}

		// Track thread names from thread/name/updated notifications (SDK ThreadNameUpdatedNotification)
		if (n.method === "thread/name/updated") {
			const nameThreadId = safeString(params.threadId);
			const threadName = safeString(params.threadName ?? params.name).trim();
			if (nameThreadId) {
				if (threadName) {
					state.cxThreadNames.set(nameThreadId, threadName);
				} else {
					state.cxThreadNames.delete(nameThreadId); // name cleared
				}
			}
		}

		handleCodexRuntimeNotification({
			method: n.method,
			params,
			sockets: state.sockets,
			send: streams.send,
			safeString,
			cxThreadOwners: state.cxThreadOwners,
			cxThreadCwds: state.cxThreadCwds,
			cxThreadNames: state.cxThreadNames,
		});

		if (!threadId && params.turn?.threadId) {
			threadId = safeString(params.turn.threadId);
		}

		if (!threadId && params.item?.threadId) {
			threadId = safeString(params.item.threadId);
		}

		// Cache items for approval requests
		if (n.method === "item/started" || n.method === "item/completed") {
			const item = params.item;
			const itemId = safeString(item?.id);
			if (threadId && turnId && itemId) {
				state.cxItemCache.set(`${threadId}:${turnId}:${itemId}`, item);
				if (state.cxItemCache.size > CX_ITEM_CACHE_MAX) {
					const keys = [...state.cxItemCache.keys()];
					for (let i = 0; i < CX_ITEM_CACHE_PRUNE; i++) state.cxItemCache.delete(keys[i]!);
				}
				if (safeString(item?.type) === "fileChange" && n.method === "item/started") {
					void fileUndo.snapshotCodexFileChange(threadId, turnId, itemId, item).catch(() => {});
				}
				if (safeString(item?.type) === "fileChange" && n.method === "item/completed") {
					const status = safeString(item?.status).toLowerCase();
					const key = `${threadId}:${turnId}:${itemId}`;
					if (status.includes("completed") && state.cxFileChangeSnapshots.has(key)) {
						fileUndo.ensureUndoStack(threadId).push(key);
					} else {
						state.cxFileChangeSnapshots.delete(key);
					}
				}

				// Handle context compaction events
				if (safeString(item?.type) === "contextCompaction") {
					const compactionStatus = n.method === "item/started" ? "started" : "completed";
					deps.log.logInfo(`[Codex] context compaction ${compactionStatus}: threadId=${threadId}`);
				}
			}
		}

		// Resolve owner EARLY so all downstream code can use it safely
		const owner = threadId ? state.cxThreadOwners.get(threadId) : null;

		// Track latest running turn for abort
		if (n.method === "turn/started") {
			const tid = safeString(params.turn?.id);
			if (threadId && tid) state.cxActiveTurns.set(threadId, tid);
		}
		if (n.method === "turn/completed") {
			const tid = safeString(params.turn?.id);
			if (threadId && tid && state.cxActiveTurns.get(threadId) === tid) {
				state.cxActiveTurns.delete(threadId);
				// Clear event buffer — turn is done, no more streaming gap risk
				state.cxEventBuffers.delete(threadId);
			}
		}

		// Log turn lifecycle events for debugging
		if (n.method === "turn/started") {
			deps.log.logInfo(`[Codex] turn/started: threadId=${threadId}, turnId=${turnId}`);
		}
		if (n.method === "turn/completed") {
			const turnStatus = safeString(params.turn?.status).toLowerCase();
			const turnError = params.turn?.error;
			deps.log.logInfo(`[Codex] turn/completed: threadId=${threadId}, turnId=${turnId}, status=${turnStatus}`);

			if (turnStatus === "failed" && turnError && threadId) {
				deps.log.logError(`[Codex] turn/completed with failed status:`, JSON.stringify(turnError, null, 2));

				const errDetails = extractCodexErrorDetails(turnError, "turn_failed");
				streams.emitCxStream(
					threadId,
					{
						type: "error",
						message: errDetails.errorMessage,
						code: errDetails.derivedErrorCode,
						details: turnError,
						modelCapModel: errDetails.modelCapModel,
						modelCapRetrySeconds: errDetails.modelCapRetrySeconds,
					},
					owner,
				);
			}
		}
		// Handle turn failures and errors - EMIT TO CLIENT, not just log!
		if (n.method === "error") {
			const turn = params.turn;
			const error = turn?.error ?? params.error ?? params;
			deps.log.logError(`[Codex] ${n.method}: threadId=${threadId}`, JSON.stringify(error, null, 2));
			if (threadId) {
				state.cxActiveTurns.delete(threadId);

				// CRITICAL: Emit error to client so UI knows the turn failed
				const errDetails = extractCodexErrorDetails(error, n.method);
				streams.emitCxStream(
					threadId,
					{
						type: "error",
						message: errDetails.errorMessage,
						code: errDetails.derivedErrorCode,
						details: error,
						modelCapModel: errDetails.modelCapModel,
						modelCapRetrySeconds: errDetails.modelCapRetrySeconds,
					},
					owner,
				);

				const runtimeStatePayload: ServerMessage = {
					type: "runtime_state",
					backend: "codex",
					data: buildCodexRuntimeState({
						threadId,
						cwd: state.cxThreadCwds.get(threadId),
						isStreaming: false,
					}),
				};
				if (owner) {
					streams.send(owner, runtimeStatePayload);
				}
				sessions.broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);

				// UI state is now driven by runtime_state (sent above).
			}
		}
		// Handle thread/compacted (deprecated notification)
		if (n.method === "thread/compacted") {
			deps.log.logInfo(`[Codex] thread/compacted (deprecated): threadId=${threadId}`);
			if (threadId) {
				streams.emitCxStream(threadId, { type: "notification", method: "thread/compacted", params }, owner);
			}
		}

		// Log response items for debugging
		if (n.method === "item/started" || n.method === "item/completed") {
			const item = params.item;
			const itemType = safeString(item?.type);
			const itemId = safeString(item?.id);
			deps.log.logInfo(`[Codex] ${n.method}: threadId=${threadId}, itemType=${itemType}, itemId=${itemId}`);
		}

		if (!threadId) {
			// Some notifications are global (no threadId): auth, rate limits, MCP oauth completion, etc.
			for (const ws of state.sockets) {
				streams.send(ws, {
					type: "cx_global",
					data: { method: n.method, params },
				});
			}
			return;
		}

		streams.emitCxStream(threadId, { type: "notification", method: n.method, params }, owner);

		// Send busy/idle events for background indicators/notifications
		if (owner && n.method === "turn/started" && threadId) {
			const runtimeStatePayload: ServerMessage = {
				type: "runtime_state",
				backend: "codex",
				data: buildCodexRuntimeState({
					threadId,
					cwd: state.cxThreadCwds.get(threadId),
					isStreaming: true,
				}),
			};
			streams.send(owner, runtimeStatePayload);
			sessions.broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);
		}
		if (owner && n.method === "turn/completed" && threadId) {
			const runtimeStatePayload: ServerMessage = {
				type: "runtime_state",
				backend: "codex",
				data: buildCodexRuntimeState({
					threadId,
					cwd: state.cxThreadCwds.get(threadId),
					isStreaming: false,
				}),
			};
			streams.send(owner, runtimeStatePayload);
			sessions.broadcastToSessionWatchers("codex", threadId, runtimeStatePayload, owner);
		}
	};
}
