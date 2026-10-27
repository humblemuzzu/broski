/**
 * A runtime event too large for the link is shrunk instead of dropped: a tool card left without its
 * `tool_finished`, or a turn without its end, is a session that never settles on the phone.
 */

import { frameBytes } from "../transport/send-limits";
import type { ServerMessage } from "../types";
import { cutLargestString } from "./json-string-slots";

type RuntimeEventMessage = Extract<ServerMessage, { type: "runtime_event" }>;

/** Truncating the largest string a few times is enough; a deeper hunt means the shape is odd. */
const MAX_PASSES = 6;
/** What stays on a minimal event even when nothing else fits. */
const IDENTITY_FIELDS = [
	"type",
	"backend",
	"timestampMs",
	"sessionId",
	"cwd",
	"messageId",
	"toolCallId",
	"streamId",
	"turnId",
	"seq",
	"toolName",
	"isError",
] as const;

/** Room for the marker a pass adds, so one cut lands under the limit instead of trading bytes with it. */
const MARKER_RESERVE = 64;

function truncatedCopy(message: RuntimeEventMessage): RuntimeEventMessage {
	const data = message.data as Record<string, unknown> | undefined;
	return {
		...message,
		truncated: true,
		data: data === undefined ? data : { ...data, truncated: true },
	} as RuntimeEventMessage;
}

/** The same event with no payload at all: the ids and the type, nothing to render. */
function minimalEvent(message: RuntimeEventMessage): RuntimeEventMessage {
	const data = (message.data ?? {}) as Record<string, unknown>;
	const kept: Record<string, unknown> = {};
	for (const key of IDENTITY_FIELDS) {
		if (data[key] !== undefined) kept[key] = data[key];
	}
	return { ...message, truncated: true, data: { ...kept, truncated: true } } as RuntimeEventMessage;
}

/** One pass: cut the longest string by roughly the bytes that have to go, and mark it. */
function truncateLongest(event: RuntimeEventMessage, excess: number): boolean {
	const data = event.data as Record<string, unknown> | undefined;
	if (data === undefined) return false;
	return cutLargestString(data, excess + MARKER_RESERVE);
}

/** `message` marked truncated, as a frame no larger than `limit` where that is possible. */
export function shrinkRuntimeEvent(message: RuntimeEventMessage, limit: number): string {
	const original = JSON.stringify(message);
	if (frameBytes(original) <= limit) return original;
	const event = truncatedCopy(message);
	let frame = JSON.stringify(event);
	let bytes = frameBytes(frame);
	for (let pass = 0; pass < MAX_PASSES && bytes > limit; pass += 1) {
		if (!truncateLongest(event, bytes - limit)) break;
		frame = JSON.stringify(event);
		bytes = frameBytes(frame);
	}
	if (bytes <= limit) return frame;
	return JSON.stringify(minimalEvent(message));
}
