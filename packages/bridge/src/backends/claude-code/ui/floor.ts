/** Raising and ending interactions on the host's session: the one place `interaction_*` events are emitted. */

import type { AgentEvent, InteractionId, ResolutionReason } from "../../../contract";
import type { AskHost } from "../ports/asks";
import { AskLedger, type PendingAsk } from "./ledger";
import { reportAskProblem } from "./problems";

export class AskFloor {
	readonly ledger = new AskLedger();

	constructor(readonly host: AskHost) {}

	/** Registered before it is emitted: an emit that fails still leaves the ask raised in the snapshot and the ledger. */
	raise(ask: PendingAsk): void {
		this.ledger.add(ask);
		this.emit({ type: "interaction_requested", interaction: ask.interaction });
	}

	/** Ends `id` once, emitting its resolution; undefined for an id already ended. Settling the CLI's callback is the caller's. */
	finish(id: InteractionId, reason: ResolutionReason): PendingAsk | undefined {
		const ask = this.ledger.take(id);
		if (ask) this.emit({ type: "interaction_resolved", interactionId: id, reason });
		return ask;
	}

	withdraw(id: InteractionId, reason: ResolutionReason): void {
		this.finish(id, reason)?.end();
	}

	withdrawAll(asks: readonly PendingAsk[], reason: ResolutionReason): void {
		for (const ask of asks) this.withdraw(ask.interaction.id, reason);
	}

	stopRun(): void {
		try {
			this.host.abortRun().catch((error) => reportAskProblem("abortRun", error));
		} catch (error) {
			reportAskProblem("abortRun", error);
		}
	}

	private emit(event: AgentEvent): void {
		try {
			this.host.live.emit(event);
		} catch (error) {
			reportAskProblem(event.type, error);
		}
	}
}
