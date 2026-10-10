import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";

type CoalescerTarget = ServerWebSocket<unknown> | null | undefined;
type CoalescerEmit = (message: ServerMessage, target: CoalescerTarget) => void;

/**
 * How long a text delta waits for company. The phone already sees 50–300 ms of network on
 * Tailscale, so a few milliseconds of extra delay is invisible next to the repeated envelope
 * (`type`, `backend`, `sessionId`, `streamId`, `seq`, …) that merging removes per delta.
 */
const DEFAULT_FLUSH_DELAY_MS = 4;
/** Merge until the delta is this big, then send — bounds both memory and the delay to first text. */
const MAX_MERGED_CHARS = 32 * 1024;

type PendingEntry = {
	message: ServerMessage;
	target: CoalescerTarget;
	chars: number;
};

/**
 * Turn a burst of text deltas into one delta carrying the concatenated text.
 *
 * Deltas are merged per `(session, type, streamId)`, so a batch of 10 deltas with the same
 * envelope costs one envelope instead of 10. Anything that is not a text/thinking delta flushes
 * the session's pending deltas first, which keeps the order the app reduces in.
 *
 * The merged event *is* the one recorded for replay, and it carries the newest `seq`, so a
 * reconnect replays the merged event and the app's fingerprint (which is the seq) dedupes it.
 */
export class RuntimeEventCoalescer {
	private readonly pending = new Map<string, Map<string, PendingEntry>>();
	private readonly timers = new Map<string, Timer>();

	constructor(
		private readonly emit: CoalescerEmit,
		private readonly flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
	) {}

	push(message: ServerMessage, target?: CoalescerTarget): void {
		const delta = coalescibleOf(message);
		if (!delta) {
			if (message.type === "runtime_event") this.flushSession(sessionKeyOf(message));
			this.emit(message, target);
			return;
		}

		let byStream = this.pending.get(delta.sessionKey);
		if (!byStream) {
			byStream = new Map<string, PendingEntry>();
			this.pending.set(delta.sessionKey, byStream);
		}

		const existing = byStream.get(delta.key);
		if (existing) {
			existing.message = mergeDelta(existing.message, message);
			existing.target = existing.target ?? target;
			existing.chars += delta.chars;
			if (existing.chars >= MAX_MERGED_CHARS) {
				this.flushSession(delta.sessionKey);
				return;
			}
		} else {
			byStream.set(delta.key, { message, target, chars: delta.chars });
		}
		this.scheduleFlush(delta.sessionKey);
	}

	flushAll(): void {
		for (const sessionKey of [...this.pending.keys()]) this.flushSession(sessionKey);
	}

	private flushSession(sessionKey: string): void {
		const timer = this.timers.get(sessionKey);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(sessionKey);
		}
		const byStream = this.pending.get(sessionKey);
		if (!byStream) return;
		this.pending.delete(sessionKey);
		for (const entry of byStream.values()) this.emit(entry.message, entry.target);
	}

	private scheduleFlush(sessionKey: string): void {
		if (this.timers.has(sessionKey)) return;
		const timer = setTimeout(() => {
			this.timers.delete(sessionKey);
			this.flushSession(sessionKey);
		}, this.flushDelayMs);
		this.timers.set(sessionKey, timer);
	}
}

export function sessionKeyOf(message: ServerMessage): string {
	if (message.type !== "runtime_event") return "";
	const { sessionId, cwd } = message.data;
	return `${message.backend}::${sessionId ?? cwd ?? ""}`;
}

function coalescibleOf(message: ServerMessage): { key: string; sessionKey: string; chars: number } | null {
	if (message.type !== "runtime_event") return null;
	const data = message.data;
	if (data.type !== "assistant_text_delta" && data.type !== "assistant_thinking_delta") return null;
	return {
		key: `${data.type}:${data.streamId ?? ""}`,
		sessionKey: sessionKeyOf(message),
		chars: data.delta.length,
	};
}

function mergeDelta(base: ServerMessage, next: ServerMessage): ServerMessage {
	if (base.type !== "runtime_event" || next.type !== "runtime_event") return next;
	const baseData = base.data;
	const nextData = next.data;
	if (baseData.type === "assistant_text_delta" && nextData.type === "assistant_text_delta") {
		return { ...next, data: { ...nextData, delta: baseData.delta + nextData.delta } };
	}
	if (baseData.type === "assistant_thinking_delta" && nextData.type === "assistant_thinking_delta") {
		return { ...next, data: { ...nextData, delta: baseData.delta + nextData.delta } };
	}
	return next;
}
