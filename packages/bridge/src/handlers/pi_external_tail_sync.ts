import * as pi from "../connectors/pi";
import { startPiExternalTail } from "../connectors/pi/pi-external-tail";
import type { Broadcast } from "./pi_message_helpers";
import { broadcastPiStreamMessage } from "./pi_stream_bridge";

const externalTails = new Map<string, { stop: () => void }>();

/**
 * Start an external tail for a Pi session running in the terminal.
 * The tail watches the JSONL file and emits runtime events as new
 * messages appear, so the phone sees conversation updates live.
 *
 * Only starts if the session is NOT owned by the bridge (i.e. running
 * externally in pi CLI/TUI). If the bridge owns it, we already get
 * events via session.subscribe().
 */
export async function syncPiExternalTail(
	sessionId: string,
	broadcast: Broadcast,
	debugRts: boolean,
	logDebug: (msg: string) => void,
): Promise<void> {
	// Already tailing this session
	if (externalTails.has(sessionId)) {
		console.log(`[Pi tail] Already tailing session ${sessionId}`);
		return;
	}

	// Only skip the external tail if the bridge is ACTIVELY streaming for
	// this session. Having a bridge instance alone isn't enough — after a
	// bridge restart pi_get_state creates an idle instance that never
	// generates events, but isSessionOwnedByBridge would still return true,
	// causing the external tail to be skipped and leaving the app with zero
	// event delivery.
	if (pi.isSessionActivelyStreaming(sessionId)) {
		console.log(`[Pi tail] Session ${sessionId} is actively streaming via bridge, skipping external tail`);
		return;
	}

	const filePath = await pi.resolveSessionFilePath(sessionId);
	if (!filePath) {
		console.log(`[Pi tail] Cannot resolve file for session ${sessionId}`);
		return;
	}

	console.log(`[Pi tail] Starting external tail for ${sessionId} → ${filePath}`);

	const tail = startPiExternalTail(filePath, {
		emitPiStream: (streamMsg) => {
			broadcastPiStreamMessage(broadcast, "", sessionId, streamMsg);
		},
		logDebug,
		DEBUG_RTS: debugRts,
	});

	externalTails.set(sessionId, tail);
}

/** Stop an external tail for a Pi session. */
export function stopPiExternalTail(sessionId: string): void {
	const tail = externalTails.get(sessionId);
	if (!tail) return;
	tail.stop();
	externalTails.delete(sessionId);
}

/** Stop all active external tails. */
export function stopAllPiExternalTails(): void {
	for (const tail of externalTails.values()) {
		tail.stop();
	}
	externalTails.clear();
}
