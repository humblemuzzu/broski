import type { ServerWebSocket } from "bun";
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

/** Per socket, this much unsent data means the phone is not reading any more. */
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
/** Second guard, in case frames are tiny. */
const MAX_PENDING_FRAMES = 4096;
/** While congested, retry flushing this often in case `drain` never arrives. */
const CONGESTED_RETRY_MS = 16;

export type QueueHooks = {
	/** The socket is unusable or hopelessly behind: close it so the client resyncs on reconnect. */
	onDeadSocket?: (ws: ServerWebSocket<unknown>, reason: "dropped" | "overflow") => void;
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

	send(ws: ServerWebSocket<unknown>, message: ServerMessage): void {
		if (this.shed.has(ws)) return;
		if (!isBatchableRuntimeMessage(message)) {
			this.sender.send(ws, JSON.stringify(message));
			return;
		}
		const state = this.stateFor(ws);
		this.enqueue(ws, state, JSON.stringify(message));
	}

	/**
	 * Send an already-serialised frame (proxy relay, ticks, backend-built payloads). Nothing is
	 * buffered: the caller gets the send outcome back.
	 */
	sendRaw(ws: ServerWebSocket<unknown>, payload: string | Uint8Array): SendStatus {
		if (this.shed.has(ws)) return "dropped";
		return this.sender.send(ws, payload);
	}

	/**
	 * Serialised payload that must not be dropped: held while the socket is congested and written
	 * when it drains.
	 */
	sendPayload(ws: ServerWebSocket<unknown>, payload: string): void {
		if (this.shed.has(ws)) return;
		if (!this.sender.isCongested(ws)) {
			this.sender.send(ws, payload);
			return;
		}
		const state = this.stateFor(ws);
		state.payloads.push(payload);
		state.bytes += payload.length;
		if (state.bytes > MAX_PENDING_BYTES) {
			this.shedSocket(ws, state);
			return;
		}
		this.armFlush(ws, state);
	}

	/**
	 * Send a message to all sockets with per-socket error isolation.
	 * A dead socket won't prevent other sockets from receiving the message.
	 */
	broadcast(sockets: Set<ServerWebSocket<unknown>>, message: ServerMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			this.sender.send(ws, payload);
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
		state.bytes = 0;
		if (parts.length === 1) {
			this.sender.send(ws, parts[0]!);
		} else if (parts.length > 1) {
			this.sender.send(
				ws,
				`{"type":"batch","messages":[${parts.join(",")}],"count":${parts.length},"timestamp":${Date.now()}}`,
			);
		}
		for (let i = 0; i < payloads.length; i += 1) {
			if (this.sender.isCongested(ws)) {
				const held = payloads.slice(i);
				state.payloads.push(...held);
				for (const payload of held) state.bytes += payload.length;
				this.armFlush(ws, state, CONGESTED_RETRY_MS);
				return;
			}
			this.sender.send(ws, payloads[i]!);
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

	private enqueue(ws: ServerWebSocket<unknown>, state: ClientQueueState, part: string): void {
		state.parts.push(part);
		state.bytes += part.length;
		if (state.bytes > MAX_PENDING_BYTES || state.parts.length > MAX_PENDING_FRAMES) {
			this.shedSocket(ws, state);
			return;
		}
		this.armFlush(ws, state);
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

	private shedSocket(ws: ServerWebSocket<unknown>, state: ClientQueueState): void {
		this.shedCount += 1;
		state.parts.length = 0;
		state.payloads.length = 0;
		state.bytes = 0;
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
