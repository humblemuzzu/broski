import type { ServerWebSocket } from "bun";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import type { ServerMessage } from "../types";
import type { PiStreamMessage } from "../types/pi";
import { recordRuntimeEvent } from "../utils/runtime-replay-buffer";

const piWatchersBySessionId = new Map<string, Set<ServerWebSocket<unknown>>>();
const piSessionIdBySocket = new Map<ServerWebSocket<unknown>, string>();

/** Sockets currently viewing a Pi session — the only ones that need its deltas. */
export function piWatchersFor(sessionId: string): Set<ServerWebSocket<unknown>> | undefined {
	return piWatchersBySessionId.get(sessionId.trim());
}

export function registerPiWatcher(ws: ServerWebSocket<unknown>, sessionId: string): void {
	const trimmed = sessionId.trim();
	if (!trimmed) return;
	unregisterPiWatcher(ws);
	const watchers = piWatchersBySessionId.get(trimmed) ?? new Set<ServerWebSocket<unknown>>();
	watchers.add(ws);
	piWatchersBySessionId.set(trimmed, watchers);
	piSessionIdBySocket.set(ws, trimmed);
}

export function unregisterPiWatcher(ws: ServerWebSocket<unknown>): void {
	const previousSessionId = piSessionIdBySocket.get(ws);
	if (previousSessionId) {
		piSessionIdBySocket.delete(ws);
		const watchers = piWatchersBySessionId.get(previousSessionId);
		if (watchers) {
			watchers.delete(ws);
			if (watchers.size === 0) {
				piWatchersBySessionId.delete(previousSessionId);
			}
		}
	}
}

/** Number of connected sockets currently viewing a Pi session. */
export function countPiWatchers(sessionId: string): number {
	return piWatchersBySessionId.get(sessionId.trim())?.size ?? 0;
}

/**
 * Forget watchers whose socket is no longer connected, since nothing calls
 * unregisterPiWatcher on disconnect. Returns the sessions that lost their last
 * watcher so callers can release session-scoped resources (external tails).
 */
export function prunePiWatchers(isLive: (ws: ServerWebSocket<unknown>) => boolean): string[] {
	const orphaned: string[] = [];
	for (const [sessionId, watchers] of piWatchersBySessionId) {
		for (const ws of [...watchers]) {
			if (isLive(ws)) continue;
			watchers.delete(ws);
			piSessionIdBySocket.delete(ws);
		}
		if (watchers.size === 0) {
			piWatchersBySessionId.delete(sessionId);
			orphaned.push(sessionId);
		}
	}
	return orphaned;
}

/**
 * Replay pending Pi extension UI requests for a reconnecting watcher.
 * Called from session_view when a Pi watcher is registered (set_view).
 */
export function replayPendingExtensionUiRequests(
	ws: ServerWebSocket<unknown>,
	sessionId: string,
	pendingRequests: PiStreamMessage[],
	cwd: string,
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void,
): number {
	if (pendingRequests.length === 0) return 0;

	for (const streamMsg of pendingRequests) {
		const runtimeEvent = mapPiStreamToRuntimeEvent(streamMsg, {
			backend: "pi",
			sessionId,
			cwd,
		});
		if (!runtimeEvent) continue;

		const payload: ServerMessage = {
			type: "runtime_event",
			backend: "pi",
			data: {
				...runtimeEvent,
				replayed: true,
			},
		};
		recordRuntimeEvent(payload);
		send(ws, payload);
	}
	return pendingRequests.length;
}
