import type { ServerWebSocket } from "bun";

export type SendStatus = "sent" | "congested" | "dropped";

export type SocketSenderStats = {
	sent: number;
	congested: number;
	drops: number;
	congestedSockets: number;
};

export type SocketSenderHooks = {
	/** `send()` returned 0: the frame was dropped because the connection is gone. */
	onDropped?: (ws: ServerWebSocket<unknown>) => void;
};

/**
 * The one place an outbound frame leaves the bridge.
 *
 * `ServerWebSocket.send` reports the outcome instead of applying it: `> 0` bytes written,
 * `-1` written into a backpressured buffer, `0` dropped because the connection is closed.
 * Every send site reads that report here, so a stalled phone is visible (congested) instead
 * of silently growing the socket buffer.
 */
export class SocketSender {
	private readonly congested = new Set<ServerWebSocket<unknown>>();
	private sent = 0;
	private congestedSends = 0;
	private drops = 0;

	constructor(private readonly hooks: SocketSenderHooks = {}) {}

	send(ws: ServerWebSocket<unknown>, payload: string | Uint8Array): SendStatus {
		let status = 0;
		try {
			// `compress` is ignored unless the socket negotiated permessage-deflate.
			status = ws.send(payload, true);
		} catch {
			status = 0;
		}

		if (status > 0) {
			this.sent += 1;
			// uWS only reports -1 while the socket's buffer is above its low-water mark,
			// so a byte count means the socket is accepting again.
			this.congested.delete(ws);
			return "sent";
		}
		if (status < 0) {
			this.congestedSends += 1;
			this.congested.add(ws);
			return "congested";
		}

		this.drops += 1;
		this.congested.delete(ws);
		this.hooks.onDropped?.(ws);
		return "dropped";
	}

	isCongested(ws: ServerWebSocket<unknown>): boolean {
		return this.congested.has(ws);
	}

	/** Bun's `drain` callback: the socket can take more data again. */
	drain(ws: ServerWebSocket<unknown>): boolean {
		return this.congested.delete(ws);
	}

	clear(ws: ServerWebSocket<unknown>): void {
		this.congested.delete(ws);
	}

	stats(): SocketSenderStats {
		return {
			sent: this.sent,
			congested: this.congestedSends,
			drops: this.drops,
			congestedSockets: this.congested.size,
		};
	}
}
