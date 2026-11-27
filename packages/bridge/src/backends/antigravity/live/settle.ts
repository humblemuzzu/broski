/**
 * A session agy has just loaded takes no prompt until agy has settled the load. Measured on agy 1.5.18: of 10 prompts
 * sent the moment a `session/load` answered, 3 were never answered; each time agy streamed a model step without the
 * person's input (its answer to the restart notice it adds after a load), then logged `Session …: IDLE while 1 of the
 * turn's 1 user inputs are still to arrive; waiting for the turn's run`. Of 8 sent 3 s after a load, none stalled.
 * The race is agy's, and its fix belongs in agy.
 *
 * The first prompt is held until agy's own step has ended (the `usage_update` that ends a model step, after output of
 * agy's own), or until agy has shown none for `quietMs`; a step that never ends holds it `longestMs` at most. What agy
 * streams before the person's prompt has gone is not the person's run.
 */

import type { SessionUpdate } from "../acp/frames";

export interface SettleBounds {
	/** How long agy may show nothing of its own after the load before the prompt goes. */
	readonly quietMs: number;
	/** How long a step of agy's own may hold the prompt, counted from the load. */
	readonly longestMs: number;
}

export const LOAD_SETTLE: SettleBounds = { quietMs: 3_000, longestMs: 60_000 };

const OWN_OUTPUT = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update"]);

interface Held {
	readonly send: () => void;
	readonly drop: () => void;
}

export class LoadSettle {
	private settled = false;
	private ownStep = false;
	private held: Held | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** `bounds` for a session agy has just loaded; none for one it has not, which is never held. */
	constructor(bounds: SettleBounds | undefined) {
		if (bounds === undefined) {
			this.settled = true;
			return;
		}
		this.wait(bounds.quietMs, () => {
			if (this.ownStep) this.wait(bounds.longestMs - bounds.quietMs, () => this.settle());
			else this.settle();
		});
	}

	/** Whether `update` is agy's own, streamed before the person's prompt went: no run's to show. */
	own(update: SessionUpdate): boolean {
		if (this.settled) return false;
		if (OWN_OUTPUT.has(update.sessionUpdate)) {
			this.ownStep = true;
			return true;
		}
		if (update.sessionUpdate === "usage_update" && this.ownStep) this.settle();
		return false;
	}

	/** `send` once agy has settled the load; `stopped`, with nothing sent, when the person stops the turn first. */
	send<T>(send: () => Promise<T>, stopped: T): Promise<T> {
		if (this.settled) return send();
		return new Promise((resolve) => {
			this.held = { send: () => void send().then(resolve), drop: () => resolve(stopped) };
		});
	}

	/** The person stopped the turn: a prompt still held is never sent. True when one was. */
	stop(): boolean {
		const held = this.held;
		this.held = undefined;
		held?.drop();
		return held !== undefined;
	}

	/** The session is no longer hosted: nothing held goes. */
	end(): void {
		this.stop();
		this.settled = true;
		clearTimeout(this.timer);
	}

	private wait(ms: number, then: () => void): void {
		this.timer = setTimeout(then, ms);
		this.timer.unref();
	}

	private settle(): void {
		if (this.settled) return;
		this.settled = true;
		clearTimeout(this.timer);
		const held = this.held;
		this.held = undefined;
		held?.send();
	}
}
