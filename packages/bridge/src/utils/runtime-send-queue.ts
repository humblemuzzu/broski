import type { ServerWebSocket } from "bun";
import { frameBytes, NETWORK_SEND_LIMITS, responseTooLargeFrame, type SendLimits } from "../transport/send-limits";
import { type SendStatus, SocketSender, type SocketSenderStats } from "../transport/socket-sender";
import type { ServerMessage } from "../types";
import { shrinkRuntimeEvent } from "./truncate-runtime-event";

type ConnectionSnapshot = {
	lastRttMs: number;
};

/** A serialised frame and its UTF-8 size, measured once where it was built. */
type Frame = { payload: string | Uint8Array; bytes: number };

type ClientQueueState = {
	parts: Frame[];
	payloads: Frame[];
	partBytes: number;
	payloadBytes: number;
	timer: Timer | null;
};

type QueueThresholds = {
	low: number;
	high: number;
	burst: number;
};

type QueueStats = SocketSenderStats & {
	pendingFrames: number;
	pendingBytes: number;
	shed: number;
};

/** While congested, retry flushing this often in case `drain` never arrives. */
const CONGESTED_RETRY_MS = 16;

export type QueueHooks = {
	/** Per-socket limits. Defaults to {@link NETWORK_SEND_LIMITS}. */
	limitsFor?: (ws: ServerWebSocket<unknown>) => SendLimits;
	/** The socket is unusable or hopelessly behind: close it so the client resyncs on reconnect. */
	onDeadSocket?: (ws: ServerWebSocket<unknown>, reason: "dropped" | "overflow", detail?: string) => void;
	/** A frame was refused because this peer could never take it whole. It was not written. */
	onResponseTooLarge?: (ws: ServerWebSocket<unknown>, detail: { type: string; bytes: number; limit: number }) => void;
};

const THRESHOLDS = {
	lowLatency: { low: 6, high: 3, burst: 1 },
	mediumLatency: { low: 10, high: 5, burst: 2 },
	highLatency: { low: 16, high: 8, burst: 4 },
} satisfies Record<string, QueueThresholds>;

function isBatchableRuntimeMessage(message: ServerMessage): boolean {
	if (message.type !== "runtime_event") return false;
	const eventType = message.data?.type;
	return (
		eventType === "assistant_text_delta" || eventType === "assistant_thinking_delta" || eventType === "tool_updated"
	);
}

function requestIdOf(message: ServerMessage): string | undefined {
	return "requestId" in message ? message.requestId : undefined;
}

export class RuntimeSendQueue {
	private readonly queues = new Map<ServerWebSocket<unknown>, ClientQueueState>();
	private readonly shed = new Set<ServerWebSocket<unknown>>();
	private readonly sender: SocketSender;
	private shedCount = 0;

	constructor(
		private readonly getContext: (ws: ServerWebSocket<unknown>) => ConnectionSnapshot | undefined,
		private readonly hooks: QueueHooks = {},
	) {
		this.sender = new SocketSender({
			onDropped: (ws) => {
				// Nothing lands on a closed socket: stop trying until the close handler disposes it.
				this.shed.add(ws);
				this.hooks.onDeadSocket?.(ws, "dropped");
			},
		});
	}

	/**
	 * Ordered outbound path for a single message. Deltas wait for company; every other runtime
	 * event joins the same queue and is written at once, so a tool or permission event can never
	 * overtake the text streamed before it.
	 */
	send(ws: ServerWebSocket<unknown>, message: ServerMessage): void {
		const payload = JSON.stringify(message);
		this.deliver(ws, message, { payload, bytes: frameBytes(payload) });
	}

	/**
	 * Send an already-serialised frame (proxy relay, ticks, backend-built payloads). Nothing is
	 * buffered: the caller gets the send outcome back.
	 */
	sendRaw(ws: ServerWebSocket<unknown>, payload: string | Uint8Array): SendStatus {
		if (this.shed.has(ws)) return "dropped";
		const frame: Frame = { payload, bytes: frameBytes(payload) };
		if (this.overMessageLimit(ws, frame.bytes)) {
			this.refuse(ws, "raw", frame.bytes, undefined);
			return "dropped";
		}
		return this.write(ws, frame);
	}

	/**
	 * Serialised payload that must not be dropped: held while the socket is congested and written
	 * when it drains. [requestId] is the reply's own, so a refusal reaches the caller waiting on it.
	 */
	sendPayload(ws: ServerWebSocket<unknown>, payload: string, requestId?: string): void {
		if (this.shed.has(ws)) return;
		const frame: Frame = { payload, bytes: frameBytes(payload) };
		if (this.overMessageLimit(ws, frame.bytes)) {
			this.refuse(ws, "payload", frame.bytes, requestId);
			return;
		}
		if (!this.sender.isCongested(ws)) {
			this.write(ws, frame);
			return;
		}
		const state = this.stateFor(ws);
		state.payloads.push(frame);
		state.payloadBytes += frame.bytes;
		if (this.overPendingLimit(ws, state)) {
			this.shedSocket(ws, state);
			return;
		}
		this.armFlush(ws, state);
	}

	/**
	 * Send a message to all sockets with per-socket error isolation, through the same shed set and
	 * congestion accounting as `send()`: a socket declared dead takes nothing, and a byte the queue
	 * held for one socket is never written to another.
	 */
	broadcast(sockets: Set<ServerWebSocket<unknown>>, message: ServerMessage): void {
		const payload = JSON.stringify(message);
		const frame: Frame = { payload, bytes: frameBytes(payload) };
		for (const ws of sockets) {
			this.deliver(ws, message, frame);
		}
	}

	/** Bun's `drain` callback: the socket took data again, write whatever was held back. */
	onDrain(ws: ServerWebSocket<unknown>): void {
		this.sender.drain(ws);
		this.flush(ws);
	}

	disposeSocket(ws: ServerWebSocket<unknown>): void {
		const state = this.queues.get(ws);
		this.sender.clear(ws);
		this.shed.delete(ws);
		if (!state) return;
		if (state.timer) clearTimeout(state.timer);
		this.queues.delete(ws);
	}

	flush(ws: ServerWebSocket<unknown>): void {
		const state = this.queues.get(ws);
		if (!state || (state.parts.length === 0 && state.payloads.length === 0)) return;
		if (state.timer) {
			clearTimeout(state.timer);
			state.timer = null;
		}

		if (this.sender.isCongested(ws)) {
			// Held deltas go out as one merged frame when the socket drains, instead of growing
			// the socket buffer frame by frame.
			this.armFlush(ws, state, CONGESTED_RETRY_MS);
			return;
		}

		const parts = state.parts.splice(0, state.parts.length);
		const payloads = state.payloads.splice(0, state.payloads.length);
		state.partBytes = 0;
		state.payloadBytes = 0;
		if (parts.length > 0 && !this.writeParts(ws, parts)) return;
		for (let i = 0; i < payloads.length; i += 1) {
			if (this.sender.isCongested(ws)) {
				const held = payloads.slice(i);
				state.payloads.push(...held);
				for (const payload of held) state.payloadBytes += payload.bytes;
				this.armFlush(ws, state, CONGESTED_RETRY_MS);
				return;
			}
			this.write(ws, payloads[i]!);
			if (this.shed.has(ws)) return;
		}
	}

	stats(): QueueStats {
		let pendingFrames = 0;
		let pendingBytes = 0;
		for (const state of this.queues.values()) {
			pendingFrames += state.parts.length + state.payloads.length;
			pendingBytes += state.partBytes + state.payloadBytes;
		}
		return { ...this.sender.stats(), pendingFrames, pendingBytes, shed: this.shedCount };
	}

	private deliver(ws: ServerWebSocket<unknown>, message: ServerMessage, frame: Frame): void {
		if (this.shed.has(ws)) return;
		if (this.overMessageLimit(ws, frame.bytes)) {
			this.replaceOversize(ws, message, frame.bytes);
			return;
		}
		if (message.type !== "runtime_event") {
			this.flush(ws);
			this.write(ws, frame);
			return;
		}
		const state = this.stateFor(ws);
		this.enqueue(ws, state, frame);
		if (!isBatchableRuntimeMessage(message)) this.flush(ws);
	}

	/**
	 * A frame this peer could never take whole. Held frames were produced before it, so they go
	 * out first; then a runtime event is shrunk to fit, and anything else is answered in its place.
	 */
	private replaceOversize(ws: ServerWebSocket<unknown>, message: ServerMessage, bytes: number): void {
		const limit = this.messageLimit(ws);
		this.flush(ws);
		if (this.shed.has(ws)) return;
		if (message.type === "runtime_event") {
			const payload = shrinkRuntimeEvent(message, limit);
			this.write(ws, { payload, bytes: frameBytes(payload) });
			return;
		}
		this.refuse(ws, message.type, bytes, requestIdOf(message));
	}

	/** The frame is never written: the caller gets `response_too_large` with its own request id. */
	private refuse(ws: ServerWebSocket<unknown>, type: string, bytes: number, requestId: string | undefined): void {
		const limit = this.messageLimit(ws);
		this.flush(ws);
		if (this.shed.has(ws)) return;
		this.hooks.onResponseTooLarge?.(ws, { type, bytes, limit });
		const payload = JSON.stringify(responseTooLargeFrame(requestId, bytes, limit));
		this.write(ws, { payload, bytes: frameBytes(payload) });
	}

	/**
	 * The one write. A link socket is never handed a frame that would push it past its window — Bun's
	 * own guard is off for it, so that is the only way the peer could lose one — nor one that would
	 * overtake a frame already held for it. Those wait in the queue for the daemon to read, and the
	 * socket is closed only when what waits outgrows a second window.
	 */
	private write(ws: ServerWebSocket<unknown>, frame: Frame): SendStatus {
		const limits = this.limitsFor(ws);
		if (limits.kind === "link" && this.mustWait(ws, frame)) return this.holdForLink(ws, frame);
		return this.sender.send(ws, frame.payload);
	}

	private mustWait(ws: ServerWebSocket<unknown>, frame: Frame): boolean {
		const held = this.queues.get(ws)?.payloads.length ?? 0;
		return held > 0 || ws.getBufferedAmount() + frame.bytes > this.limitsFor(ws).maxPendingBytes;
	}

	private holdForLink(ws: ServerWebSocket<unknown>, frame: Frame): SendStatus {
		const state = this.stateFor(ws);
		state.payloads.push(frame);
		state.payloadBytes += frame.bytes;
		if (this.overPendingLimit(ws, state)) {
			this.shedSocket(ws, state);
			return "dropped";
		}
		this.armFlush(ws, state, CONGESTED_RETRY_MS);
		return "congested";
	}

	/** One frame for the whole burst, unless merging it would build a frame the link cannot take. */
	private writeParts(ws: ServerWebSocket<unknown>, parts: Frame[]): boolean {
		if (parts.length === 1) {
			this.write(ws, parts[0]!);
			return !this.shed.has(ws);
		}
		const batch = `{"type":"batch","messages":[${parts.map((part) => String(part.payload)).join(",")}],"count":${parts.length},"timestamp":${Date.now()}}`;
		if (this.overMessageLimit(ws, frameBytes(batch))) {
			for (const part of parts) {
				this.write(ws, part);
				if (this.shed.has(ws)) return false;
			}
			return true;
		}
		this.write(ws, { payload: batch, bytes: frameBytes(batch) });
		return !this.shed.has(ws);
	}

	private enqueue(ws: ServerWebSocket<unknown>, state: ClientQueueState, frame: Frame): void {
		state.parts.push(frame);
		state.partBytes += frame.bytes;
		if (this.overPendingLimit(ws, state)) {
			this.shedSocket(ws, state);
			return;
		}
		this.armFlush(ws, state);
	}

	private limitsFor(ws: ServerWebSocket<unknown>): SendLimits {
		return this.hooks.limitsFor?.(ws) ?? NETWORK_SEND_LIMITS;
	}

	/** The largest single frame this peer takes whole, or infinity when it has no frame cap. */
	private messageLimit(ws: ServerWebSocket<unknown>): number {
		const limits = this.limitsFor(ws);
		return limits.kind === "link" ? limits.maxMessageBytes : Number.POSITIVE_INFINITY;
	}

	private overMessageLimit(ws: ServerWebSocket<unknown>, bytes: number): boolean {
		return bytes > this.messageLimit(ws);
	}

	/**
	 * A network socket may owe 4 MiB in all. A link socket's deltas have the window the socket itself has,
	 * and the replies waiting for the daemon a second one of their own.
	 */
	private overPendingLimit(ws: ServerWebSocket<unknown>, state: ClientQueueState): boolean {
		const limits = this.limitsFor(ws);
		if (state.parts.length > limits.maxPendingFrames) return true;
		if (limits.kind === "link") {
			return state.partBytes > limits.maxPendingBytes || state.payloadBytes > limits.maxHeldBytes;
		}
		return state.partBytes + state.payloadBytes > limits.maxPendingBytes;
	}

	private stateFor(ws: ServerWebSocket<unknown>): ClientQueueState {
		let state = this.queues.get(ws);
		if (!state) {
			state = { parts: [], payloads: [], partBytes: 0, payloadBytes: 0, timer: null };
			this.queues.set(ws, state);
		}
		return state;
	}

	private armFlush(ws: ServerWebSocket<unknown>, state: ClientQueueState, delayMs?: number): void {
		if (state.timer) return;
		const delay = delayMs ?? this.batchDelay(ws, state.parts.length + state.payloads.length);
		state.timer = setTimeout(() => {
			state.timer = null;
			this.flush(ws);
		}, delay);
	}

	private shedSocket(ws: ServerWebSocket<unknown>, state: ClientQueueState): void {
		this.shedCount += 1;
		const detail = `buffered=${ws.getBufferedAmount()}B held=${state.payloadBytes}B deltas=${state.partBytes}B frames=${state.parts.length + state.payloads.length}`;
		this.disposeSocket(ws);
		// Nothing else is written to this socket until it is closed and disposed.
		this.shed.add(ws);
		this.hooks.onDeadSocket?.(ws, "overflow", detail);
	}

	private batchDelay(ws: ServerWebSocket<unknown>, pendingCount: number): number {
		const ctx = this.getContext(ws);
		const rtt = ctx?.lastRttMs ?? 0;
		let thresholds = THRESHOLDS.lowLatency;
		if (rtt > 100) {
			thresholds = THRESHOLDS.highLatency;
		} else if (rtt > 30) {
			thresholds = THRESHOLDS.mediumLatency;
		}
		if (pendingCount > 32) return thresholds.burst;
		if (pendingCount > 8) return thresholds.high;
		return thresholds.low;
	}
}
