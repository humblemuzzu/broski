/**
 * A runtime event too large for the link is shrunk instead of dropped: a tool card left without its
 * `tool_finished`, or a turn without its end, is a session that never settles on the phone.
 */

import { frameBytes } from "../transport/send-limits";
import type { ServerMessage } from "../types";

type RuntimeEventMessage = Extract<ServerMessage, { type: "runtime_event" }>;

/** Nesting after this is not where a huge payload lives, and walking it costs more than it saves. */
const MAX_DEPTH = 8;
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

const marker = (removed: number) => `…[truncated by the bridge: ${removed} bytes]`;

/** Room for the marker a pass adds, so one cut lands under the limit instead of trading bytes with it. */
const MARKER_RESERVE = 64;

type Slot = { path: Array<string | number>; length: number };

function largestString(value: unknown, path: Array<string | number> = [], depth = 0): Slot | null {
	if (typeof value === "string") return { path, length: value.length };
	if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return null;
	const entries: Array<[string | number, unknown]> = Array.isArray(value)
		? value.map((item, index) => [index, item])
		: Object.entries(value);
	let best: Slot | null = null;
	for (const [key, item] of entries) {
		const found = largestString(item, [...path, key], depth + 1);
		if (found && (best === null || found.length > best.length)) best = found;
	}
	return best;
}

function readAt(root: unknown, path: Array<string | number>): unknown {
	let current = root;
	for (const key of path) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

function writeAt(root: unknown, path: Array<string | number>, value: string): void {
	if (path.length === 0) return;
	const parent = readAt(root, path.slice(0, -1));
	if (parent === null || typeof parent !== "object") return;
	(parent as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}

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
	const slot = largestString(data);
	if (!slot) return false;
	const text = readAt(data, slot.path);
	if (typeof text !== "string") return false;
	const removed = Math.max(1, Math.min(text.length, excess + MARKER_RESERVE));
	writeAt(data, slot.path, `${text.slice(0, text.length - removed)}${marker(removed)}`);
	return true;
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
