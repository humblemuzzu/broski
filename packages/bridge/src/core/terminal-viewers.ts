import { TerminalEvent, type TerminalId } from "../contract";
import type { CoreClient } from "./client";
import type { CoreLog } from "./ports";
import { fitMessage } from "./wire-fit";

/**
 * Who a terminal's output goes to: the clients attached to it, and nobody else. Each event is checked,
 * fitted and encoded once, and every viewer gets that frame in the order the terminal produced it. Nothing
 * follows `term_exited`, so a terminal has viewers only while it runs, and no client views more terminals
 * than run at once.
 */
export class TerminalViewers {
	private readonly viewers = new Map<TerminalId, Set<CoreClient>>();

	constructor(
		private readonly maxFrameBytes: number,
		private readonly log: CoreLog,
	) {}

	/** The workspace's sink; like a session sink, it never throws into the terminal that called it. */
	readonly publish = (event: TerminalEvent): void => {
		try {
			this.fanOut(event);
		} catch (error) {
			this.log.error(`[core] a terminal event failed in the core: ${String(error)}`);
		}
	};

	attach(id: TerminalId, client: CoreClient): void {
		let viewers = this.viewers.get(id);
		if (!viewers) {
			viewers = new Set();
			this.viewers.set(id, viewers);
		}
		viewers.add(client);
		client.terminals.add(id);
	}

	/** False when the client was not attached to the terminal. */
	detach(id: TerminalId, client: CoreClient): boolean {
		const viewers = this.viewers.get(id);
		if (!viewers?.delete(client)) return false;
		client.terminals.delete(id);
		if (viewers.size === 0) this.viewers.delete(id);
		return true;
	}

	private forget(id: TerminalId): void {
		for (const client of this.viewers.get(id) ?? []) client.terminals.delete(id);
		this.viewers.delete(id);
	}

	/** The client went away, or no longer speaks the bridge's protocol. */
	leave(client: CoreClient): void {
		for (const id of [...client.terminals]) this.detach(id, client);
	}

	private fanOut(event: TerminalEvent): void {
		const viewers = this.viewers.get(event.id);
		if (!viewers) return;
		const checked = TerminalEvent.safeParse(event);
		if (!checked.success) {
			this.log.error(`[core] dropped a terminal event that breaks the contract: ${checked.error.message}`);
			return;
		}
		const frame = fitMessage(event, this.maxFrameBytes, this.log);
		if (!frame) {
			this.log.error(`[core] dropped a ${event.type} of terminal ${JSON.stringify(event.id)} too large for the link`);
			return;
		}
		for (const client of viewers) client.send(frame);
		if (event.type === "term_exited") this.forget(event.id);
	}
}
