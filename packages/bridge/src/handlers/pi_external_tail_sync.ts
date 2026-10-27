import * as pi from "../connectors/pi";
import { startPiExternalTail } from "../connectors/pi/pi-external-tail";
import type { PiStreamMessage } from "../types/pi";
import type { Broadcast } from "./pi_message_helpers";
import { broadcastPiStreamMessage } from "./pi_stream_delivery";

const externalTails = new Map<string, { stop: () => void }>();

type TailRequest = { broadcast: Broadcast; debugRts: boolean; logDebug: (msg: string) => void };

/** Sessions someone is viewing, so a tail paused for a bridge-run turn knows to come back. */
const wantedTails = new Map<string, TailRequest>();

async function startTail(sessionId: string, request: TailRequest): Promise<void> {
	if (externalTails.has(sessionId)) return;

	const filePath = await pi.resolveSessionFilePath(sessionId);
	if (!filePath) {
		console.log(`[Pi tail] Cannot resolve file for session ${sessionId}`);
		return;
	}

	console.log(`[Pi tail] Starting external tail for ${sessionId} → ${filePath}`);

	const tail = startPiExternalTail(filePath, {
		emitPiStream: (streamMsg) => {
			broadcastPiStreamMessage(request.broadcast, "", sessionId, streamMsg);
		},
		logDebug: request.logDebug,
		DEBUG_RTS: request.debugRts,
	});

	externalTails.set(sessionId, tail);
}

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
	const request = { broadcast, debugRts, logDebug };
	wantedTails.set(sessionId, request);
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

	await startTail(sessionId, request);
}

/** Stop an external tail for a Pi session. */
export function stopPiExternalTail(sessionId: string): void {
	wantedTails.delete(sessionId);
	pauseTail(sessionId);
}

function pauseTail(sessionId: string): void {
	const tail = externalTails.get(sessionId);
	if (!tail) return;
	tail.stop();
	externalTails.delete(sessionId);
}

/**
 * While the bridge runs a turn it streams every event itself, so the file the turn writes must not be
 * replayed on top of it. The tail stops when the turn starts and comes back, starting at the end of the
 * file, once the agent has settled.
 */
export function onBridgeTurnBoundary(sessionId: string, streamType: PiStreamMessage["type"]): void {
	if (streamType === "agent-start") {
		pauseTail(sessionId);
		return;
	}
	if (streamType !== "agent-settled") return;
	const request = wantedTails.get(sessionId);
	if (request) void startTail(sessionId, request);
}

/** Stop all active external tails. */
export function stopAllPiExternalTails(): void {
	wantedTails.clear();
	for (const tail of externalTails.values()) {
		tail.stop();
	}
	externalTails.clear();
}
