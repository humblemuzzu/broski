/**
 * How far behind a bridge is on what its holder sends it. `pi` is never made to wait (`holder.ts`), so a bridge that
 * stops reading is dropped rather than buffered for without end. A backlog alone is no sign of that: a tool's progress
 * record may be as large as the JSONL cap (32 MiB, `rpc/jsonl.ts`), and a burst of them outruns any reader for a moment.
 * A stall is a matter of time: a bridge is dropped when its backlog stays past `soft` for `graceMs` without the socket
 * draining, or passes `hard` at all. What is left of its replay, which it reads first, is not counted.
 */

import type { Socket } from "node:net";
import type { HolderClock } from "./holder";

export interface BacklogLimits {
	readonly soft: number;
	readonly hard: number;
	readonly graceMs: number;
}

export const BACKLOG_LIMITS: BacklogLimits = {
	soft: 32 * 1024 * 1024,
	hard: 128 * 1024 * 1024,
	graceMs: 5_000,
};

export class BacklogWatch {
	/** An upper bound on what is unsent of the replay: the oldest bytes queued, so it drains first. */
	private replayLeft: number;
	private cancelGrace: (() => void) | undefined;

	constructor(
		private readonly socket: Socket,
		private readonly clock: HolderClock,
		private readonly limits: BacklogLimits,
		private readonly drop: () => void,
	) {
		this.replayLeft = socket.writableLength;
		socket.on("drain", () => this.stopGrace());
	}

	/** After each write to the socket. */
	wrote(): void {
		const behind = this.behind();
		if (behind > this.limits.hard) {
			this.stop();
			this.drop();
			return;
		}
		if (behind <= this.limits.soft || this.cancelGrace !== undefined) return;
		this.cancelGrace = this.clock.after(this.limits.graceMs, () => {
			this.cancelGrace = undefined;
			if (this.behind() > this.limits.soft) this.drop();
		});
	}

	stop(): void {
		this.stopGrace();
	}

	private stopGrace(): void {
		this.cancelGrace?.();
		this.cancelGrace = undefined;
	}

	private behind(): number {
		const queued = this.socket.writableLength;
		this.replayLeft = Math.min(this.replayLeft, queued);
		return queued - this.replayLeft;
	}
}
