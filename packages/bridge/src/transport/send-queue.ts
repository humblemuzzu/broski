import type { ServerWebSocket } from "bun";
import { frameBytes, NETWORK_SEND_LIMITS, type SendLimits } from "./send-limits";
import { type SendStatus, SocketSender } from "./socket-sender";

/** A serialised frame and its UTF-8 size, measured once where it was built. */
type Frame = { payload: string | Uint8Array; bytes: number };

type HeldFrames = {
	frames: Frame[];
	bytes: number;
	timer: Timer | null;
};

/** While congested, retry flushing this often in case `drain` never arrives. */
const CONGESTED_RETRY_MS = 16;

export type QueueHooks = {
	/** Per-socket limits. Defaults to {@link NETWORK_SEND_LIMITS}. */
	limitsFor?: (ws: ServerWebSocket<unknown>) => SendLimits;
	/** The socket is unusable or hopelessly behind: close it so the client resyncs on reconnect. */
	onDeadSocket?: (ws: ServerWebSocket<unknown>, reason: "dropped" | "overflow", detail?: string) => void;
	/** A frame larger than this peer takes whole was refused. It was not written. */
	onTooLarge?: (ws: ServerWebSocket<unknown>, detail: { bytes: number; limit: number }) => void;
};

/**
 * Every frame the bridge writes to a client socket, in order, per socket, never blocking another: a frame
 * the socket cannot take now is held and written when it drains. A network socket that owes too much is
 * shed; a link socket (the daemon) is never handed a frame past its window and is closed only when what
 * waits for it outgrows a second window (`send-limits.ts`).
 */
export class SendQueue {
	private readonly held = new Map<ServerWebSocket<unknown>, HeldFrames>();
	private readonly shed = new Set<ServerWebSocket<unknown>>();
	private readonly sender: SocketSender;

	constructor(private readonly hooks: QueueHooks = {}) {
		this.sender = new SocketSender({
			onDropped: (ws) => {
				// Nothing lands on a closed socket: stop trying until the close handler disposes it.
				this.shed.add(ws);
				this.hooks.onDeadSocket?.(ws, "dropped");
			},
		});
	}

	/** An already-serialised frame that must not be dropped: held while the socket is congested. */
	sendPayload(ws: ServerWebSocket<unknown>, payload: string): void {
		if (this.shed.has(ws)) return;
		const frame: Frame = { payload, bytes: frameBytes(payload) };
		if (this.refusedForSize(ws, frame)) return;
		if (!this.sender.isCongested(ws)) {
			this.write(ws, frame);
			return;
		}
		this.hold(ws, frame);
	}

	/** Bun's `drain` callback: the socket took data again, write whatever was held back. */
	onDrain(ws: ServerWebSocket<unknown>): void {
		this.sender.drain(ws);
		this.flush(ws);
	}

	disposeSocket(ws: ServerWebSocket<unknown>): void {
		const held = this.held.get(ws);
		this.sender.clear(ws);
		this.shed.delete(ws);
		if (!held) return;
		if (held.timer) clearTimeout(held.timer);
		this.held.delete(ws);
	}

	private flush(ws: ServerWebSocket<unknown>): void {
		const held = this.held.get(ws);
		if (!held || held.frames.length === 0) return;
		if (held.timer) {
			clearTimeout(held.timer);
			held.timer = null;
		}
		const frames = held.frames.splice(0, held.frames.length);
		held.bytes = 0;
		for (let i = 0; i < frames.length; i += 1) {
			if (this.sender.isCongested(ws)) {
				const rest = frames.slice(i);
				held.frames.push(...rest);
				for (const frame of rest) held.bytes += frame.bytes;
				this.armFlush(ws, held);
				return;
			}
			this.write(ws, frames[i]!);
			if (this.shed.has(ws)) return;
		}
	}

	/**
	 * The one write. A link socket is never handed a frame that would push it past its window — Bun's own guard
	 * is off for it, so that is the only way the peer could lose one — nor one that would overtake a frame
	 * already held for it.
	 */
	private write(ws: ServerWebSocket<unknown>, frame: Frame): SendStatus {
		const limits = this.limitsFor(ws);
		if (limits.kind === "link" && this.mustWait(ws, frame, limits.maxPendingBytes)) {
			return this.hold(ws, frame) ? "congested" : "dropped";
		}
		return this.sender.send(ws, frame.payload);
	}

	private mustWait(ws: ServerWebSocket<unknown>, frame: Frame, window: number): boolean {
		const held = this.held.get(ws)?.frames.length ?? 0;
		return held > 0 || ws.getBufferedAmount() + frame.bytes > window;
	}

	/** Holds the frame for the next flush; false when holding it sheds the socket. */
	private hold(ws: ServerWebSocket<unknown>, frame: Frame): boolean {
		let held = this.held.get(ws);
		if (!held) {
			held = { frames: [], bytes: 0, timer: null };
			this.held.set(ws, held);
		}
		held.frames.push(frame);
		held.bytes += frame.bytes;
		if (this.overHeldLimit(ws, held)) {
			this.shedSocket(ws, held);
			return false;
		}
		this.armFlush(ws, held);
		return true;
	}

	/** A network socket may owe its window in all; a link socket's held frames have a second window of their own. */
	private overHeldLimit(ws: ServerWebSocket<unknown>, held: HeldFrames): boolean {
		const limits = this.limitsFor(ws);
		if (held.frames.length > limits.maxPendingFrames) return true;
		return held.bytes > (limits.kind === "link" ? limits.maxHeldBytes : limits.maxPendingBytes);
	}

	private refusedForSize(ws: ServerWebSocket<unknown>, frame: Frame): boolean {
		const limits = this.limitsFor(ws);
		if (limits.kind !== "link" || frame.bytes <= limits.maxMessageBytes) return false;
		this.hooks.onTooLarge?.(ws, { bytes: frame.bytes, limit: limits.maxMessageBytes });
		return true;
	}

	private limitsFor(ws: ServerWebSocket<unknown>): SendLimits {
		return this.hooks.limitsFor?.(ws) ?? NETWORK_SEND_LIMITS;
	}

	private armFlush(ws: ServerWebSocket<unknown>, held: HeldFrames): void {
		if (held.timer) return;
		held.timer = setTimeout(() => {
			held.timer = null;
			this.flush(ws);
		}, CONGESTED_RETRY_MS);
	}

	private shedSocket(ws: ServerWebSocket<unknown>, held: HeldFrames): void {
		const detail = `buffered=${ws.getBufferedAmount()}B held=${held.bytes}B frames=${held.frames.length}`;
		this.disposeSocket(ws);
		// Nothing else is written to this socket until it is closed and disposed.
		this.shed.add(ws);
		this.hooks.onDeadSocket?.(ws, "overflow", detail);
	}
}
