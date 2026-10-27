import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";

type CoalescerTarget = ServerWebSocket<unknown> | null | undefined;
type CoalescerEmit = (message: ServerMessage, target: CoalescerTarget) => void;

/**
 * How long a stream's next frame waits for company. The first delta of a burst is emitted at once,
 * so first-token latency is unchanged; only the deltas after it wait for this window to close.
 */
const DEFAULT_FLUSH_CADENCE_MS = 45;
/** Merge until the delta is this big, then send — bounds both memory and how much text one frame carries. */
const MAX_MERGED_CHARS = 32 * 1024;
/** How long a stream's "last frame at" is remembered after the stream goes quiet. */
const STREAM_STATE_TTL_MS = 5_000;

type PendingEntry = {
	message: ServerMessage;
	target: CoalescerTarget;
	chars: number;
};

/**
 * Turn a burst of text deltas into as few frames as the cadence allows: the first delta of a stream
 * at once, the rest merged per `(session, type, streamId)` and emitted one cadence apart.
 *
 * Anything that is not a text/thinking delta flushes the session's pending deltas first, which keeps
 * the order the app reduces in. A merged event carries the newest `seq` so replay dedupe still keys
 * on it, and `seqStart` names the oldest one so the app's `seq > previous + 1` gap check does not read
 * a merge as lost events.
 *
 * The cadence is not rtt-driven: one merged frame fans out to every viewer, and the per-socket queue
 * batches again against the rtt it measured for that socket.
 */
export class RuntimeEventCoalescer {
	private readonly pending = new Map<string, Map<string, PendingEntry>>();
	private readonly timers = new Map<string, Timer>();
	/** Per stream, when its last frame left: `session` → `type:streamId` → timestamp. */
	private readonly lastFrameAt = new Map<string, Map<string, number>>();

	constructor(
		private readonly emit: CoalescerEmit,
		private readonly cadenceMs = DEFAULT_FLUSH_CADENCE_MS,
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
			if (existing.chars >= MAX_MERGED_CHARS) this.flushSession(delta.sessionKey);
			return;
		}

		const now = Date.now();
		const dueAt = (this.lastFrameOf(delta.sessionKey, delta.key) ?? 0) + this.cadenceMs;
		if (now >= dueAt) {
			this.rememberFrame(delta.sessionKey, delta.key, now);
			this.emit(message, target);
			return;
		}
		byStream.set(delta.key, { message, target, chars: delta.chars });
		this.scheduleFlush(delta.sessionKey, dueAt - now);
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
		const now = Date.now();
		for (const [key, entry] of byStream) {
			this.rememberFrame(sessionKey, key, now);
			this.emit(entry.message, entry.target);
		}
	}

	private scheduleFlush(sessionKey: string, delayMs: number): void {
		if (this.timers.has(sessionKey)) return;
		const timer = setTimeout(() => {
			this.timers.delete(sessionKey);
			this.flushSession(sessionKey);
		}, delayMs);
		this.timers.set(sessionKey, timer);
	}

	private lastFrameOf(sessionKey: string, key: string): number | undefined {
		return this.lastFrameAt.get(sessionKey)?.get(key);
	}

	private rememberFrame(sessionKey: string, key: string, at: number): void {
		const state = this.lastFrameAt.get(sessionKey) ?? new Map<string, number>();
		state.set(key, at);
		this.lastFrameAt.set(sessionKey, state);
		for (const [otherKey, otherAt] of state) {
			if (at - otherAt > STREAM_STATE_TTL_MS) state.delete(otherKey);
		}
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
	const seqStart = baseData.seqStart ?? baseData.seq;
	if (baseData.type === "assistant_text_delta" && nextData.type === "assistant_text_delta") {
		const merged = { ...nextData, delta: baseData.delta + nextData.delta };
		return { ...next, data: seqStart === undefined ? merged : { ...merged, seqStart } };
	}
	if (baseData.type === "assistant_thinking_delta" && nextData.type === "assistant_thinking_delta") {
		const merged = { ...nextData, delta: baseData.delta + nextData.delta };
		return { ...next, data: seqStart === undefined ? merged : { ...merged, seqStart } };
	}
	return next;
}
