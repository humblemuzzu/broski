import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";

type ConnectionType = "local" | "tailscale" | "unknown";

type ConnectionSnapshot = {
	lastRttMs: number;
	connectionType: ConnectionType;
};

type ClientQueueState = {
	messages: ServerMessage[];
	timer: Timer | null;
};

type QueueThresholds = {
	low: number;
	high: number;
	burst: number;
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

	constructor(private readonly getContext: (ws: ServerWebSocket<unknown>) => ConnectionSnapshot | undefined) {}

	send(ws: ServerWebSocket<unknown>, message: ServerMessage): void {
		if (!isBatchableRuntimeMessage(message)) {
			this.sendImmediate(ws, message);
			return;
		}

		let state = this.queues.get(ws);
		if (!state) {
			state = { messages: [], timer: null };
			this.queues.set(ws, state);
		}
		state.messages.push(message);
		if (state.timer) return;
		state.timer = setTimeout(() => this.flush(ws), this.batchDelay(ws, state.messages.length));
	}

	/**
	 * Send a message to all sockets with per-socket error isolation.
	 * A dead socket won't prevent other sockets from receiving the message.
	 */
	broadcast(sockets: Set<ServerWebSocket<unknown>>, message: ServerMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of sockets) {
			try {
				ws.send(payload);
			} catch {
				this.disposeSocket(ws);
			}
		}
	}

	disposeSocket(ws: ServerWebSocket<unknown>): void {
		const state = this.queues.get(ws);
		if (!state) return;
		if (state.timer) clearTimeout(state.timer);
		this.queues.delete(ws);
	}

	flush(ws: ServerWebSocket<unknown>): void {
		const state = this.queues.get(ws);
		if (!state || state.messages.length === 0) return;
		if (state.timer) {
			clearTimeout(state.timer);
			state.timer = null;
		}
		const messages = state.messages.splice(0, state.messages.length);
		if (messages.length === 1) {
			this.sendImmediate(ws, messages[0]!);
			return;
		}
		this.sendImmediate(ws, {
			type: "batch",
			messages,
			count: messages.length,
			timestamp: Date.now(),
		} as ServerMessage);
	}

	private sendImmediate(ws: ServerWebSocket<unknown>, message: ServerMessage): void {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			this.disposeSocket(ws);
		}
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
