import type { ServerWebSocket } from "bun";
import type { PiDurableSocket } from "../types/pi-durable";
import type { RuntimeSendQueue } from "../utils/runtime-send-queue";

/**
 * The durable backend's transport writes pre-serialised frames straight to the socket it is
 * attached to (`handlers/pi_durable/view.ts`). Wrapping each socket once keeps that narrow
 * `{ send(payload) }` contract intact while the frames go through the send queue, so a congested
 * phone holds them instead of growing the socket buffer.
 */
export class PiDurableSocketPool {
	private readonly sockets = new WeakMap<ServerWebSocket<unknown>, PiDurableSocket>();

	constructor(private readonly queue: RuntimeSendQueue) {}

	for(ws: ServerWebSocket<unknown>): PiDurableSocket {
		let socket = this.sockets.get(ws);
		if (!socket) {
			socket = { send: (payload: string, requestId?: string) => this.queue.sendPayload(ws, payload, requestId) };
			this.sockets.set(ws, socket);
		}
		return socket;
	}
}
