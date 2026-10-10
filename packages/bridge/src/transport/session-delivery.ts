import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";
import type { BroskiRuntimeEvent } from "../types/runtime";

/**
 * Runtime events a socket that is *not* viewing the session still needs, because the sessions
 * list shows live busy/idle/retry state and the "last tool" of every session — not just the one
 * on screen (`lib/providers/sessions/runtime_session_activity_handler.dart`). Text and thinking
 * deltas, tool output and backend-specific chatter only go to the sockets viewing that session.
 */
const CROSS_SESSION_EVENT_TYPES = new Set([
	"agent_started",
	"agent_finished",
	"session_state_changed",
	"error",
	"retry_started",
	"retry_finished",
	"compaction_started",
	"compaction_finished",
	"tool_started",
	"permission_requested",
	"user_input_requested",
]);

export function isCrossSessionActivity(message: ServerMessage): boolean {
	if (message.type !== "runtime_event") return false;
	return CROSS_SESSION_EVENT_TYPES.has(message.data.type);
}

/**
 * The copy sent to sockets that are not viewing the session is stripped of `seq`.
 *
 * Cross-session fan-out is deliberately sparse, so consecutive activity events carry a seq gap.
 * The app reads `seq > lastEventSeq + 1` as "events were lost" and answers by moving its view to
 * that session (`lib/providers/chat/runtime_chat_ingest.dart:249`), which would yank the phone
 * off the chat it is on. Without a seq the event still drives the sessions list and never touches
 * that comparison.
 */
export function withoutSeq(message: ServerMessage): ServerMessage {
	if (message.type !== "runtime_event") return message;
	if (message.data.seq === undefined) return message;
	const data: Record<string, unknown> = { ...message.data };
	delete data.seq;
	return { ...message, data: data as BroskiRuntimeEvent };
}

export type SessionDelivery = {
	message: ServerMessage;
	/** The socket that sent the prompt (or an explicit target from a handler), if any. */
	owner?: ServerWebSocket<unknown> | null;
	/** Sockets whose current view is this session. */
	viewers?: Set<ServerWebSocket<unknown>>;
	sockets: Iterable<ServerWebSocket<unknown>>;
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void;
};

/**
 * One runtime event → the sockets that should see it: the owner and every socket viewing the
 * session get the event itself; every other socket gets it only when it is cross-session
 * activity, and without a seq.
 */
export function deliverRuntimeEvent(delivery: SessionDelivery): number {
	const { message, owner, viewers, sockets, send } = delivery;
	const reached = new Set<ServerWebSocket<unknown>>();

	if (owner) {
		send(owner, message);
		reached.add(owner);
	}
	if (viewers) {
		for (const ws of viewers) {
			if (reached.has(ws)) continue;
			send(ws, message);
			reached.add(ws);
		}
	}

	if (!isCrossSessionActivity(message)) return reached.size;

	const activity = withoutSeq(message);
	for (const ws of sockets) {
		if (reached.has(ws)) continue;
		send(ws, activity);
		reached.add(ws);
	}
	return reached.size;
}
