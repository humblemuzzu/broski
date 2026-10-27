import type { ServerWebSocket } from "bun";
import { frameBytes, NETWORK_SEND_LIMITS, responseTooLargeFrame, type SendLimits } from "../transport/send-limits";
import { type SendStatus, SocketSender, type SocketSenderStats } from "../transport/socket-sender";
import type { ServerMessage } from "../types";

type ConnectionType = "local" | "tailscale" | "unknown";

type ConnectionSnapshot = {
	lastRttMs: number;
	connectionType: ConnectionType;
};

type ClientQueueState = {
	parts: string[];
	payloads: string[];
	bytes: number;
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
	onDeadSocket?: (ws: ServerWebSocket<unknown>, reason: "dropped" | "overflow") => void;
	/** A frame was refused because this peer could never take it whole. It was not written. */
	onResponseTooLarge?: (ws: ServerWebSocket<unknown>, detail: { type: string; bytes: number; limit: number }) => void;
};

const THRESHOLDS = {
	local: { low: 6, high: 3, burst: 1 },
	tailscale: { low: 10, high: 5, burst: 2 },
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
		this.deliver(ws, message, JSON.stringify(message));
	}

	/**
	 * Send an already-serialised frame (proxy relay, ticks, backend-built payloads). Nothing is
	 * buffered: the caller gets the send outcome back.
	 */
	sendRaw(ws: ServerWebSocket<unknown>, payload: string | Uint8Array): SendStatus {
		if (this.shed.has(ws)) return "dropped";
		if (!this.admit(ws, "raw", payload, undefined)) return "dropped";
		return this.write(ws, payload);
	}

	/**
	 * Serialised payload that must not be dropped: held while the socket is congested and written
	 * when it drains.
	 */
	sendPayload(ws: ServerWebSocket<unknown>, payload: string): void {
		if (this.shed.has(ws)) return;
		if (!this.admit(ws, "payload", payload, undefined)) return;
		if (!this.sender.isCongested(ws)) {
			this.write(ws, payload);
			return;
		}
		const state = this.stateFor(ws);
		state.payloads.push(payload);
		state.bytes += payload.length;
		if (this.overPendingLimit(ws, state)) {
			this.shedSocket(ws);
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
		for (const ws of sockets) {
			this.deliver(ws, message, payload);
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
		const mergedBytes = state.bytes;
		state.bytes = 0;
		if (parts.length > 0 && !this.writeParts(ws, parts, mergedBytes)) return;
		for (let i = 0; i < payloads.length; i += 1) {
			if (this.sender.isCongested(ws)) {
				const held = payloads.slice(i);
				state.payloads.push(...held);
				for (const payload of held) state.bytes += payload.length;
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
			pendingBytes += state.bytes;
		}
		return { ...this.sender.stats(), pendingFrames, pendingBytes, shed: this.shedCount };
	}

	private deliver(ws: ServerWebSocket<unknown>, message: ServerMessage, payload: string): void {
		if (this.shed.has(ws)) return;
		if (!this.admit(ws, message.type, payload, requestIdOf(message))) return;
		if (message.type !== "runtime_event") {
			this.flush(ws);
			this.write(ws, payload);
			return;
		}
		const state = this.stateFor(ws);
		this.enqueue(ws, state, payload);
		if (!isBatchableRuntimeMessage(message)) this.flush(ws);
	}

	/** False when the frame can never reach this peer whole: it is answered instead of written. */
	private admit(
		ws: ServerWebSocket<unknown>,
		type: string,
		payload: string | Uint8Array,
		requestId: string | undefined,
	): boolean {
		const limits = this.limitsFor(ws);
		if (limits.kind !== "link") return true;
		const bytes = frameBytes(payload);
		if (bytes <= limits.maxMessageBytes) return true;
		this.hooks.onResponseTooLarge?.(ws, { type, bytes, limit: limits.maxMessageBytes });
		this.write(ws, JSON.stringify(responseTooLargeFrame(requestId, bytes, limits.maxMessageBytes)));
		return false;
	}

	/**
	 * The one write. A link socket is never handed a frame that would push it past its window:
	 * that is the only case where the peer would drop it, because Bun's own guard is off for it.
	 */
	private write(ws: ServerWebSocket<unknown>, payload: string | Uint8Array): SendStatus {
		const limits = this.limitsFor(ws);
		if (limits.kind === "link" && ws.getBufferedAmount() + frameBytes(payload) > limits.maxPendingBytes) {
			this.shedSocket(ws);
			return "dropped";
		}
		return this.sender.send(ws, payload);
	}

	/** One frame for the whole burst, unless merging it would build a frame the link cannot take. */
	private writeParts(ws: ServerWebSocket<unknown>, parts: string[], mergedBytes: number): boolean {
		const limits = this.limitsFor(ws);
		if (parts.length === 1 || (limits.kind === "link" && mergedBytes > limits.maxMessageBytes)) {
			for (const part of parts) {
				this.write(ws, part);
				if (this.shed.has(ws)) return false;
			}
			return true;
		}
		this.write(
			ws,
			`{"type":"batch","messages":[${parts.join(",")}],"count":${parts.length},"timestamp":${Date.now()}}`,
		);
		return !this.shed.has(ws);
	}

	private enqueue(ws: ServerWebSocket<unknown>, state: ClientQueueState, part: string): void {
		state.parts.push(part);
		state.bytes += part.length;
		if (this.overPendingLimit(ws, state)) {
			this.shedSocket(ws);
			return;
		}
		this.armFlush(ws, state);
	}

	private limitsFor(ws: ServerWebSocket<unknown>): SendLimits {
		return this.hooks.limitsFor?.(ws) ?? NETWORK_SEND_LIMITS;
	}

	private overPendingLimit(ws: ServerWebSocket<unknown>, state: ClientQueueState): boolean {
		const limits = this.limitsFor(ws);
		return state.bytes > limits.maxPendingBytes || state.parts.length > limits.maxPendingFrames;
	}

	private stateFor(ws: ServerWebSocket<unknown>): ClientQueueState {
		let state = this.queues.get(ws);
		if (!state) {
			state = { parts: [], payloads: [], bytes: 0, timer: null };
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

	private shedSocket(ws: ServerWebSocket<unknown>): void {
		this.shedCount += 1;
		this.disposeSocket(ws);
		// Nothing else is written to this socket until it is closed and disposed.
		this.shed.add(ws);
		this.hooks.onDeadSocket?.(ws, "overflow");
	}

	private batchDelay(ws: ServerWebSocket<unknown>, pendingCount: number): number {
		const ctx = this.getContext(ws);
		const connectionType = ctx?.connectionType ?? "unknown";
		const rtt = ctx?.lastRttMs ?? 0;
		let thresholds = THRESHOLDS.local;
		if (rtt > 100) {
			thresholds = THRESHOLDS.highLatency;
		} else if (rtt > 30 || connectionType === "tailscale") {
			thresholds = THRESHOLDS.tailscale;
		}
		if (pendingCount > 32) return thresholds.burst;
		if (pendingCount > 8) return thresholds.high;
		return thresholds.low;
	}
}
