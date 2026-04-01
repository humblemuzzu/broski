import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";
import type { PiStreamMessage } from "../types/pi";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import { recordRuntimeEvent } from "../utils/runtime-replay-buffer";

const SESSION_EVENT_BUFFER_SIZE = 100;
const EVENT_TTL_MS = 60_000;

const piWatchersBySessionId = new Map<string, Set<ServerWebSocket<unknown>>>();
const piSessionIdBySocket = new Map<ServerWebSocket<unknown>, string>();
const piEventBuffers = new Map<string, Array<{ message: ServerMessage; ts: number }>>();
const piSendQueues = new Map<ServerWebSocket<unknown>, { messages: ServerMessage[]; timer: Timer | null }>();

function send(ws: ServerWebSocket<unknown>, message: ServerMessage): boolean {
	try {
		ws.send(JSON.stringify(message));
		return true;
	} catch {
		return false;
	}
}

function isBatchablePiRuntimeMessage(message: ServerMessage): boolean {
	return (
		message.type === "runtime_event" &&
		(message.data?.type === "assistant_text_delta" ||
			message.data?.type === "assistant_thinking_delta" ||
			message.data?.type === "tool_updated")
	);
}

function flushPiSendQueue(ws: ServerWebSocket<unknown>): boolean {
	const state = piSendQueues.get(ws);
	if (!state || state.messages.length === 0) return true;
	if (state.timer) {
		clearTimeout(state.timer);
		state.timer = null;
	}
	const messages = state.messages.splice(0, state.messages.length);
	if (messages.length === 1) {
		return send(ws, messages[0]!);
	}
	return send(ws, {
		type: "batch",
		messages,
		count: messages.length,
		timestamp: Date.now(),
	} as ServerMessage);
}

function enqueuePiRuntimeMessage(ws: ServerWebSocket<unknown>, message: ServerMessage): boolean {
	if (!isBatchablePiRuntimeMessage(message)) {
		return send(ws, message);
	}
	const state = piSendQueues.get(ws) ?? { messages: [], timer: null };
	state.messages.push(message);
	if (!state.timer) {
		state.timer = setTimeout(() => {
			const ok = flushPiSendQueue(ws);
			if (!ok) {
				piSendQueues.delete(ws);
			}
		}, 6);
	}
	piSendQueues.set(ws, state);
	return true;
}

function trimBuffer(sessionId: string): void {
	const existing = piEventBuffers.get(sessionId);
	if (!existing || existing.length === 0) return;
	const cutoff = Date.now() - EVENT_TTL_MS;
	const recent = existing.filter((entry) => entry.ts >= cutoff);
	if (recent.length === 0) {
		piEventBuffers.delete(sessionId);
		return;
	}
	if (recent.length > SESSION_EVENT_BUFFER_SIZE) {
		recent.splice(0, recent.length - SESSION_EVENT_BUFFER_SIZE);
	}
	piEventBuffers.set(sessionId, recent);
}

function bufferEvent(sessionId: string, message: ServerMessage): void {
	const existing = piEventBuffers.get(sessionId) ?? [];
	existing.push({ message, ts: Date.now() });
	piEventBuffers.set(sessionId, existing);
	trimBuffer(sessionId);
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
	const queue = piSendQueues.get(ws);
	if (queue?.timer) {
		clearTimeout(queue.timer);
	}
	piSendQueues.delete(ws);
}

export function sendPiRuntimeEvent(sessionId: string, message: ServerMessage): void {
	trimBuffer(sessionId);
	const watchers = piWatchersBySessionId.get(sessionId);
	if (!watchers || watchers.size === 0) {
		bufferEvent(sessionId, message);
		return;
	}

	let delivered = 0;
	for (const watcher of [...watchers]) {
		if (enqueuePiRuntimeMessage(watcher, message)) {
			delivered += 1;
			continue;
		}
		watchers.delete(watcher);
		piSessionIdBySocket.delete(watcher);
	}

	if (watchers.size === 0) {
		piWatchersBySessionId.delete(sessionId);
	}
	if (delivered === 0) {
		bufferEvent(sessionId, message);
	}
}

export function replayPiRuntimeEvents(ws: ServerWebSocket<unknown>, sessionId: string): number {
	trimBuffer(sessionId);
	const buffered = piEventBuffers.get(sessionId) ?? [];
	if (buffered.length === 0) return 0;
	for (const entry of buffered) {
		const payload =
			entry.message.type === "runtime_event" && typeof entry.message.data === "object" && entry.message.data != null
				? ({
						...entry.message,
						data: {
							...(entry.message.data as Record<string, unknown>),
							replayed: true,
						},
					} as ServerMessage)
				: entry.message;
		send(ws, payload);
	}
	piEventBuffers.delete(sessionId);
	return buffered.length;
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
