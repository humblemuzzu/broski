/**
 * The list row of a session this bridge hosts, kept from what the host sees, and announced as `session_updated` once a
 * view has opened it and whenever its status, model or title changes (contract README §5, catalog sink). It starts as
 * the listed row (`store/list.ts`), or as the bridge made the session when agy lists none of it yet, and is as recent
 * as the last turn of the bridge's that ended: while the bridge holds the session's lock, no other client writes to it.
 */

import { phoneName } from "../../../adapter-kit/phone-text";
import {
	type CatalogSink,
	type SessionOrigin,
	type SessionSnapshot,
	type SessionSummary,
	sessionStatus,
} from "../../../contract";

export interface RowFacts {
	readonly sessionId: string;
	readonly cwd: string | undefined;
	readonly origin: SessionOrigin;
	readonly title: string | undefined;
	readonly updatedAt: number;
}

export class HostRow {
	private title: string | undefined;
	private updatedAt: number;
	private key = "";
	private announcing = false;

	constructor(
		private readonly facts: RowFacts,
		private readonly snapshot: () => SessionSnapshot,
		private readonly catalog: CatalogSink,
		private readonly now: () => number,
	) {
		this.title = facts.title;
		this.updatedAt = facts.updatedAt;
	}

	summary(): SessionSummary {
		const snapshot = this.snapshot();
		const runStartedAt = snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
		return {
			session: { backend: "antigravity", sessionId: this.facts.sessionId },
			...(this.title !== undefined && { title: { text: this.title, source: "generated" } }),
			...(this.facts.cwd !== undefined && { cwd: this.facts.cwd }),
			updatedAt: this.updatedAt,
			...(runStartedAt !== undefined && { runStartedAt }),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			status: sessionStatus(snapshot),
			origin: this.facts.origin,
		};
	}

	/** A view has the session open: the row is announced now and at each change from now on. */
	announceFromNow(): void {
		if (this.announcing) return;
		this.announcing = true;
		this.announce();
	}

	/** An event went by: the row is announced when what the list shows of it changed. */
	touched(): void {
		if (this.keyNow() !== this.key) this.announce();
	}

	/** A turn ended, before its end is emitted, which announces the row. */
	ran(): void {
		this.updatedAt = this.now();
	}

	/** agy titled the session (`session_info_update`). */
	titled(title: string | undefined): void {
		const text = phoneName(title ?? "");
		if (text === "" || text === this.title) return;
		this.title = text;
		this.announce();
	}

	private keyNow(): string {
		const snapshot = this.snapshot();
		return `${sessionStatus(snapshot)}|${snapshot.modelId ?? ""}|${this.title ?? ""}`;
	}

	private announce(): void {
		this.key = this.keyNow();
		if (this.announcing) this.catalog.emit({ type: "session_updated", summary: this.summary() });
	}
}
