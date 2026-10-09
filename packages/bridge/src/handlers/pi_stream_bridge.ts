import * as pi from "../connectors/pi";
import { normalizeCwd } from "../connectors/pi/pi-cwd";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import {
	mapPiModelToSummary,
	mapPiSessionsToRuntimeSessions,
	mapPiStateToRuntimeState,
} from "../runtime/pi-runtime-read-models";
import type { ServerMessage } from "../types";
import type { PiModelPayload, PiStatePayload, PiStreamMessage } from "../types/pi";
import { recordRuntimeEvent } from "../utils/runtime-replay-buffer";
import type { Broadcast, Reply } from "./pi_message_helpers";
import { isPiStateChangingEvent } from "./pi_state_events";

const streamUnsubscribers = new Map<string, () => void>();

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

	const payload: ServerMessage = {
		type: "runtime_event",
		backend: "pi",
		data: runtimeEvent,
	};
	recordRuntimeEvent(payload);
	console.log(
		`[Pi RTS DEBUG] Broadcasting pi runtime_event: type=${runtimeEvent.type}, sessionId=${sessionId}, seq=${runtimeEvent.seq}`,
	);
	broadcast(payload);
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

export async function broadcastPiRuntimeSessions(broadcast: Broadcast): Promise<void> {
	try {
		const sessions = await pi.listSessions(undefined);
		const summaries = mapPiSessionsToRuntimeSessions(sessions, pi.listActiveRuntimeStates());
		broadcast({
			type: "runtime_sessions",
			backend: "pi",
			data: summaries,
		});
	} catch {
		// Non-critical — don't crash on broadcast failures
	}
}

export async function ensureStreamBridge(cwd: string, broadcast: Broadcast, force = false): Promise<void> {
	if (streamUnsubscribers.has(cwd) && !force) return;
	// If forcing, remove the stale bridge first
	if (force && streamUnsubscribers.has(cwd)) {
		const oldUnsub = streamUnsubscribers.get(cwd)!;
		streamUnsubscribers.delete(cwd);
		oldUnsub();
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
			void broadcastPiRuntimeSessions(broadcast);
		}
	});

	streamUnsubscribers.set(cwd, unsubscribe);
}

export function removeStreamBridge(cwd: string): void {
	const key = normalizeCwd(cwd);
	const unsubscribe = streamUnsubscribers.get(key);
	if (!unsubscribe) return;

	streamUnsubscribers.delete(key);
	unsubscribe();
}
