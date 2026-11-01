import type { ServerWebSocket } from "bun";
import { maybeSynthesizeAskUserQuestion } from "../handlers/cc_ask_user_question";
import { mapClaudeCodeStreamToRuntimeEvent } from "../runtime/claude-code-runtime-event-mapper";
import { RuntimeEventCoalescer } from "../transport/runtime-event-coalescer";
import { deliverRuntimeEvent } from "../transport/session-delivery";
import type { AgentType, ClaudeCodeStreamMessage, ServerMessage } from "../types";
import { recordRuntimeEvent, replayRuntimeEventsSince } from "../utils/runtime-replay-buffer";
import type { LeveledLogger } from "./logger";
import { observeRuntimeEvent } from "./runtime-observers";
import { makeSessionKey } from "./session-keys";
import type { BridgeState } from "./state";

export type ReplayParams = {
	ws: ServerWebSocket<unknown>;
	backend: AgentType;
	sessionId?: string;
	cwd?: string;
	lastSeq?: number;
};

export type Streams = {
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void;
	broadcast: (message: ServerMessage) => void;
	deliverRuntimeEventMessage: (message: ServerMessage, owner?: ServerWebSocket<unknown> | null) => void;
	emitCcStream: (
		sessionId: string,
		streamMessage: ClaudeCodeStreamMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => void;
	replayRuntimeEventsForSocket: (params: ReplayParams) => number;
};

export type StreamsDeps = {
	state: BridgeState;
	log: LeveledLogger;
	debugRts: boolean;
};

/**
 * The single path every backend's events take to the sockets: coalesce deltas, record the merged
 * event for replay, then deliver to the owner/viewers/all sockets.
 */
export function createStreams(deps: StreamsDeps): Streams {
	const { state } = deps;

	const send = (ws: ServerWebSocket<unknown>, message: ServerMessage): void => {
		state.runtimeSendQueue.send(ws, message);
	};

	const deliverRuntimeEventMessage = (message: ServerMessage, owner?: ServerWebSocket<unknown> | null): void => {
		if (message.type !== "runtime_event") return;
		const sessionId = message.data.sessionId;
		const key = makeSessionKey(message.backend, sessionId);
		deliverRuntimeEvent({
			message,
			owner: owner ?? (sessionId ? state.ccSessionOwners.get(sessionId) : null),
			viewers: key ? state.sessionWatchers.get(key) : undefined,
			sockets: state.sockets,
			send,
		});
	};

	// Delta bursts are merged before they are recorded, so the replay buffer holds exactly what
	// the sockets received.
	const runtimeCoalescer = new RuntimeEventCoalescer((message, owner) => {
		if (message.type === "runtime_event") observeRuntimeEvent(message.data);
		recordRuntimeEvent(message);
		deliverRuntimeEventMessage(message, owner);
	});

	const broadcast = (message: ServerMessage): void => {
		if (message.type === "runtime_event") {
			runtimeCoalescer.push(message);
			return;
		}
		state.runtimeSendQueue.broadcast(state.sockets, message);
	};

	const replayRuntimeEventsForSocket = (params: ReplayParams): number => {
		const replayed = replayRuntimeEventsSince({
			backend: params.backend,
			sessionId: params.sessionId,
			cwd: params.cwd,
			lastSeq: params.lastSeq,
		});
		for (const message of replayed) {
			send(params.ws, message);
		}
		return replayed.length;
	};

	const emitCcStream = (
		sessionId: string,
		streamMsg: ClaudeCodeStreamMessage,
		owner?: ServerWebSocket<unknown> | null,
	): void => {
		if (deps.debugRts) {
			const msgType = "type" in streamMsg ? String((streamMsg as Record<string, unknown>).type) : "unknown";
			const resolvedOwner = owner ?? state.ccSessionOwners.get(sessionId) ?? null;
			deps.log.logDebug(`[RTS] emitCcStream: session=${sessionId}, msgType=${msgType}, owner=${!!resolvedOwner}`);
		}

		// AskUserQuestion is YOLO-allowlisted in CC — canUseTool never fires.
		// The PreToolUse hook handles the answer path. This synthetic event is
		// a fallback to guarantee the questionnaire sheet shows on the phone.
		// Flutter dedup (pendingQuestion.id check) prevents double-showing.
		const syntheticPermReq = maybeSynthesizeAskUserQuestion(sessionId, streamMsg);
		if (syntheticPermReq) {
			emitCcStream(sessionId, syntheticPermReq, owner);
		}

		const runtimeEvent = mapClaudeCodeStreamToRuntimeEvent(streamMsg, {
			backend: "claude-code",
			sessionId,
			cwd: state.ccSessionCwds.get(sessionId),
		});
		if (!runtimeEvent) return;

		runtimeCoalescer.push(
			{
				type: "runtime_event",
				backend: "claude-code",
				data: runtimeEvent,
			},
			owner,
		);
	};

	return {
		send,
		broadcast,
		deliverRuntimeEventMessage,
		emitCcStream,
		replayRuntimeEventsForSocket,
	};
}
