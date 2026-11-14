import type { ServerWebSocket } from "bun";

export type SendStatus = "sent" | "congested" | "dropped";

export type SocketSenderHooks = {
	/** `send()` returned 0: the frame was dropped because the connection is gone. */
	onDropped?: (ws: ServerWebSocket<unknown>) => void;
};

/**
 * The one place an outbound frame leaves the bridge.
 *
 * `ServerWebSocket.send` reports the outcome instead of applying it: `> 0` bytes written,
 * `-1` accepted but over the socket's backpressure limit, `0` dropped. A congested socket is
 * remembered until Bun's `drain` callback, so the queue can hold frames back instead of
 * silently growing the socket buffer.
 */
export class SocketSender {
	private readonly congested = new Set<ServerWebSocket<unknown>>();

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
			// uWS only reports -1 while the socket's buffer is above its low-water mark,
			// so a byte count means the socket is accepting again.
			this.congested.delete(ws);
			return "sent";
		}
		if (status < 0) {
			this.congested.add(ws);
			return "congested";
		}

		this.congested.delete(ws);
		this.hooks.onDropped?.(ws);
		return "dropped";
	}

	isCongested(ws: ServerWebSocket<unknown>): boolean {
		return this.congested.has(ws);
	}

	/** Bun's `drain` callback: the socket can take more data again. */
	drain(ws: ServerWebSocket<unknown>): void {
		this.congested.delete(ws);
	}

	clear(ws: ServerWebSocket<unknown>): void {
		this.congested.delete(ws);
	}
}
