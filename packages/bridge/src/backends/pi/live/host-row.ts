/**
 * The list row of a session this bridge hosts, kept from what the host sees and announced as
 * `session_updated` whenever its status, title or model changes (contract README §5, catalog sink).
 */

import { type SessionSummary, sessionStatus } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { promptTitle } from "../mapping/prompt-title";
import { type HostedFacts, hostedSummary } from "./host-summary";
import type { LiveState } from "./live-state";

export class HostRow {
	private name: string | undefined;
	private firstPrompt: string | undefined;
	private prompted: boolean;
	private updatedAt: number;
	private lastKey = "";
	private announcing = false;

	constructor(
		private readonly start: HostedFacts,
		private readonly live: LiveState,
		private readonly catalog: CatalogFeed,
	) {
		this.name = start.name;
		this.firstPrompt = start.firstPrompt;
		this.prompted = start.prompted;
		this.updatedAt = start.updatedAt;
	}

	facts(): HostedFacts {
		return {
			...this.start,
			updatedAt: this.updatedAt,
			prompted: this.prompted,
			...(this.name !== undefined && { name: this.name }),
			...(this.firstPrompt !== undefined && { firstPrompt: this.firstPrompt }),
		};
	}

	summary(): SessionSummary {
		return hostedSummary(this.facts(), this.live.snapshot());
	}

	/** The session is open: from now on every change is announced. */
	announceFromNow(): void {
		this.announcing = true;
		this.lastKey = this.key();
	}

	/** An event went by at `now`: the row is that recent, and announced when the list would show it changed. */
	touched(now: number): void {
		if (!this.announcing) return;
		this.updatedAt = now;
		const key = this.key();
		if (key === this.lastKey) return;
		this.lastKey = key;
		this.announce();
	}

	/** A user message ended; the first one with text titles the session, as the store's rows title it (blank: no title). */
	userMessage(text: string): void {
		if (this.prompted || text === "") return;
		this.prompted = true;
		this.firstPrompt = promptTitle(text);
		this.announce();
	}

	renamed(name: string | undefined): void {
		this.name = name;
		this.announce();
	}

	private key(): string {
		const snapshot = this.live.snapshot();
		return `${sessionStatus(snapshot)}|${snapshot.modelId ?? ""}`;
	}

	private announce(): void {
		if (this.announcing) this.catalog.emit({ type: "session_updated", summary: this.summary() });
	}
}
