/** The asks raised and not yet over, and the ids of those that are: one interaction ends exactly once. */

import type { Interaction, InteractionId, InteractionReply, RunId } from "../../../contract";

export interface PendingAsk {
	readonly interaction: Interaction;
	readonly elicitationId: string | undefined;
	/** The thunk that gives the CLI this reply's answer; undefined when the reply cannot become one. */
	readonly accept: (reply: InteractionReply) => (() => void) | undefined;
	/** The ask ended without a human: the CLI gets its withdrawn answer. */
	readonly end: () => void;
}

export type AskStatus = "pending" | "resolved" | "unknown";

const REMEMBERED_RESOLVED = 10_000;

export class AskLedger {
	private readonly pending = new Map<InteractionId, PendingAsk>();
	private readonly resolved = new Set<InteractionId>();

	add(ask: PendingAsk): void {
		this.pending.set(ask.interaction.id, ask);
	}

	peek(id: InteractionId): PendingAsk | undefined {
		return this.pending.get(id);
	}

	status(id: InteractionId): AskStatus {
		if (this.pending.has(id)) return "pending";
		return this.resolved.has(id) ? "resolved" : "unknown";
	}

	/** Removes the ask for good; the first caller gets it, any other gets nothing. */
	take(id: InteractionId): PendingAsk | undefined {
		const ask = this.pending.get(id);
		if (!ask) return undefined;
		this.pending.delete(id);
		this.resolved.add(id);
		if (this.resolved.size > REMEMBERED_RESOLVED) this.forgetOldest();
		return ask;
	}

	ofRun(runId: RunId): PendingAsk[] {
		return this.all().filter((ask) => ask.interaction.runId === runId);
	}

	ofElicitation(elicitationId: string): PendingAsk[] {
		return this.all().filter((ask) => ask.elicitationId === elicitationId);
	}

	all(): PendingAsk[] {
		return [...this.pending.values()];
	}

	private forgetOldest(): void {
		const [oldest] = this.resolved;
		if (oldest !== undefined) this.resolved.delete(oldest);
	}
}
