import * as pi from "../connectors/pi";
import { normalizeCwd } from "../connectors/pi/pi-cwd";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import {
	mapPiModelToSummary,
	mapPiSessionToRuntimeSession,
	mapPiStateToRuntimeState,
} from "../runtime/pi-runtime-read-models";
import { registerSweepable } from "../state/bounded-map";
import type { PiModelPayload, PiStatePayload, PiStreamMessage } from "../types/pi";
import type { Broadcast, Reply } from "./pi_message_helpers";
import { isPiStateChangingEvent } from "./pi_state_events";

/** One event listener per project directory; a cwd nobody uses any more must not keep one. */
const MAX_STREAM_BRIDGES = 200;

const streamUnsubscribers = new Map<string, { cwd: string; unsubscribe: () => void; touchedAt: number }>();

registerSweepable({
	name: "pi-stream-bridges",
	// A listener is only useful while its directory still has a live Pi instance.
	sweep: () => {
		let dropped = 0;
		for (const [key, entry] of [...streamUnsubscribers]) {
			if (pi.getInstance(entry.cwd)) continue;
			streamUnsubscribers.delete(key);
			try {
				entry.unsubscribe();
			} catch {
				// ignore
			}
			dropped++;
		}
		if (streamUnsubscribers.size > MAX_STREAM_BRIDGES) {
			const byAge = [...streamUnsubscribers].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
			for (const [key, entry] of byAge.slice(0, streamUnsubscribers.size - MAX_STREAM_BRIDGES)) {
				streamUnsubscribers.delete(key);
				try {
					entry.unsubscribe();
				} catch {
					// ignore
				}
				dropped++;
			}
		}
		return dropped;
	},
	size: () => streamUnsubscribers.size,
	limit: () => MAX_STREAM_BRIDGES,
});

export function broadcastPiStreamMessage(
	broadcast: Broadcast,
	cwd: string,
	sessionId: string,
	streamMessage: PiStreamMessage,
): void {
	const runtimeEvent = mapPiStreamToRuntimeEvent(streamMessage, {
		backend: "pi",
		sessionId,
		cwd,
	});
	if (!runtimeEvent) return;

	broadcast({
		type: "runtime_event",
		backend: "pi",
		data: runtimeEvent,
	});
}

export function emitPiRuntimeState(reply: Reply, cwd: string, state: PiStatePayload): void {
	reply({
		type: "runtime_state",
		backend: "pi",
		data: {
			...mapPiStateToRuntimeState(state),
			cwd,
		},
	});
}

export function broadcastPiRuntimeState(broadcast: Broadcast, cwd: string, state: PiStatePayload): void {
	broadcast({
		type: "runtime_state",
		backend: "pi",
		data: {
			...mapPiStateToRuntimeState(state),
			cwd,
		},
	});
}

export function emitPiRuntimeModels(reply: Reply, models: PiModelPayload[]): void {
	reply({
		type: "runtime_models",
		backend: "pi",
		data: models.map(mapPiModelToSummary),
	});
}

/** One session changed: the app upserts that row instead of re-reading the whole list. */
export async function broadcastPiSessionDelta(broadcast: Broadcast, cwd: string, sessionId: string): Promise<void> {
	try {
		const sessions = await pi.listSessions(cwd);
		const session = sessions.find((candidate) => candidate.id === sessionId);
		if (!session) {
			broadcast({ type: "runtime_session_removed", backend: "pi", sessionId });
			return;
		}
		broadcast({
			type: "runtime_session_updated",
			backend: "pi",
			session: mapPiSessionToRuntimeSession(session, sessions),
		});
	} catch {
		// A delta the app never got is a stale row, not a broken session.
	}
}

export async function ensureStreamBridge(cwd: string, broadcast: Broadcast, force = false): Promise<void> {
	const key = normalizeCwd(cwd);
	const existing = streamUnsubscribers.get(key);
	if (existing && !force) {
		existing.touchedAt = Date.now();
		return;
	}
	if (force && existing) {
		streamUnsubscribers.delete(key);
		existing.unsubscribe();
	}

	// Create/get the instance to register with, but use dynamic lookup in the
	// event callback so session switches are reflected immediately.
	await pi.getOrCreateInstance(cwd);
	console.log(`[Pi RTS DEBUG] ensureStreamBridge: setting up event listener for cwd=${cwd}`);
	const unsubscribe = await pi.addEventListener(cwd, (event) => {
		const streamMessage = pi.translateEvent(event);
		if (!streamMessage) return;

		// Re-resolve the live instance on every event rather than using a captured
		// reference, so session switches are reflected immediately.
		const liveInstance = pi.getInstance(cwd);
		if (!liveInstance) return;

		broadcastPiStreamMessage(broadcast, cwd, liveInstance.session.sessionId, streamMessage);

		// Keep runtime_state authoritative. On start/end/error we publish a fresh
		// snapshot so the client never gets stuck in streaming state.
		if (isPiStateChangingEvent(streamMessage)) {
			const state = pi.mapStatePayload(liveInstance);
			broadcastPiRuntimeState(broadcast, cwd, state);
			void broadcastPiSessionDelta(broadcast, cwd, liveInstance.session.sessionId);
		}
	});

	streamUnsubscribers.set(key, { cwd: key, unsubscribe, touchedAt: Date.now() });
}

export function removeStreamBridge(cwd: string): void {
	const key = normalizeCwd(cwd);
	const entry = streamUnsubscribers.get(key);
	if (!entry) return;

	streamUnsubscribers.delete(key);
	entry.unsubscribe();
}
