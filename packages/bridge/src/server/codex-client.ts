import {
	CodexAppServerClient,
	type CodexNotification,
	type CodexProcessStatus,
	type CodexServerRequest,
} from "../connectors/codex";
import { buildCodexRuntimeState } from "../runtime/codex-runtime-read-models";
import type { ServerMessage } from "../types";
import { resetUnsupportedParams } from "../utils/codex-compat-retry";
import type { LeveledLogger } from "./logger";
import type { Sessions } from "./sessions";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";

export type CodexClient = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	stopCodexAppServer: () => Promise<void>;
};

export type CodexClientDeps = {
	state: BridgeState;
	streams: Streams;
	sessions: Sessions;
	onNotification: (n: CodexNotification) => void;
	onServerRequest: (r: CodexServerRequest) => Promise<unknown>;
	log: LeveledLogger;
};

/** Codex app-server process lifecycle: lazily started, and torn down with its per-thread state. */
export function createCodexClient(deps: CodexClientDeps): CodexClient {
	const { state, streams, sessions } = deps;

	const ensureCodexClient = async (): Promise<CodexAppServerClient> => {
		if (!state.codexClient) {
			const client = new CodexAppServerClient();
			client.setHandlers({
				onNotification: deps.onNotification,
				onServerRequest: deps.onServerRequest,
				// Handle app-server crash - notify all affected clients
				onExit: (code: number | null, signal: string | null) => {
					deps.log.logError(`[Codex] App-server crashed! code=${code}, signal=${signal}`);

					// Notify all thread owners that the server crashed
					for (const [threadId, owner] of state.cxThreadOwners.entries()) {
						streams.emitCxStream(
							threadId,
							{
								type: "error",
								message: "Codex agent stopped unexpectedly. It will restart automatically on your next message.",
								code: "app_server_crashed",
							},
							owner,
						);

						// Emit runtime_state with isStreaming: false for the dead thread
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

						// Legacy sdk_event removed in Phase 4 — runtime_state (above) drives UI state.
					}

					// Clean up all state
					state.cxThreadOwners.clear();
					state.cxActiveTurns.clear();
					state.cxEventBuffers.clear();
					state.cxApprovalWaiters.forEach((w) => {
						clearTimeout(w.timer);
						w.resolve({ response: "reject" });
					});
					state.cxApprovalWaiters.clear();

					// Reset client reference only if not auto-restarting
					// (connector handles restart internally when code !== 0)
					if (code === 0 || code === null) {
						state.codexClient = null;
					}
				},
				onError: (error: Error) => {
					deps.log.logError(`[Codex] App-server error:`, error.message);

					// Broadcast error to all connected clients
					for (const ws of state.sockets) {
						streams.send(ws, {
							type: "cx_global",
							data: { method: "error", params: { message: error.message } },
						});
					}
				},
				onStatusChange: (status: CodexProcessStatus) => {
					// Reset compat-retry cache on successful restart
					if (status.alive) resetUnsupportedParams();
					// Broadcast Codex process status to all connected clients
					for (const ws of state.sockets) {
						streams.send(ws, {
							type: "codex_process_status",
							data: status,
						} as any);
					}
				},
			});
			state.codexClient = client;
		}

		await state.codexClient.start();
		return state.codexClient;
	};

	const stopCodexAppServer = async (): Promise<void> => {
		const client = state.codexClient;
		state.codexClient = null;
		if (client) await client.stop();
	};

	return { ensureCodexClient, stopCodexAppServer };
}
