/**
 * The list row of a session this bridge hosts, kept from what the host sees, and announced as `session_updated` once a
 * view has opened it and whenever its status, model or title changes (contract README §5, catalog sink). It is the
 * row the session was listed by when the host began (`store/list.ts`), or the journal's row of it while agy has not
 * stored it (`store/made.ts`), with what the host knows laid over it. The listing and `getSession` show this row in
 * place of agy's (`store/sessions.ts`), so every row of a hosted session says the same.
 */

import { phoneName } from "../../../adapter-kit/phone-text";
import {
	type CatalogSink,
	type SessionOrigin,
	type SessionSnapshot,
	type SessionSummary,
	type SessionTitle,
	sessionStatus,
} from "../../../contract";
import { type ListedSession, summaryOf, titleOf } from "../store/list";

export interface RowFacts {
	readonly listed: ListedSession;
	readonly origin: SessionOrigin;
}

export class HostRow {
	/** The title agy gave the session while it is hosted. */
	private title: SessionTitle | undefined;
	private listed: ListedSession;
	private ranAt = 0;
	private key = "";
	private announcing = false;

	constructor(
		private readonly facts: RowFacts,
		private readonly snapshot: () => SessionSnapshot,
		private readonly catalog: CatalogSink,
		private readonly now: () => number,
	) {
		this.listed = facts.listed;
	}

	summary(): SessionSummary {
		const snapshot = this.snapshot();
		const listed = summaryOf(this.listed, this.facts.origin);
		const title = this.shownTitle();
		const runStartedAt = snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
		return {
			...listed,
			...(title !== undefined && { title }),
			// agy's time is its own write, in whole seconds, and the bridge's is when the host's last turn ended: the session
			// last changed at the later of the two, since no other client writes to it while the host holds its lock.
			updatedAt: Math.max(listed.updatedAt, this.ranAt),
			...(runStartedAt !== undefined && { runStartedAt }),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			status: sessionStatus(snapshot),
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
		this.ranAt = this.now();
	}

	/** agy titled the session (`session_info_update`), which no title the bridge kept of it outranks. */
	titled(title: string | undefined): void {
		const text = phoneName(title ?? "");
		if (text === "") return;
		this.title = { text, source: "generated" };
		this.touched();
	}

	/** The journal's row of a session agy has not stored changed: it holds the person's first prompt now. */
	relisted(listed: ListedSession): void {
		this.listed = listed;
		this.touched();
	}

	private shownTitle(): SessionTitle | undefined {
		return this.title ?? titleOf(this.listed);
	}

	private keyNow(): string {
		const snapshot = this.snapshot();
		const title = this.shownTitle();
		return `${sessionStatus(snapshot)}|${snapshot.modelId ?? ""}|${title?.source ?? ""}|${title?.text ?? ""}`;
	}

	private announce(): void {
		this.key = this.keyNow();
		if (this.announcing) this.catalog.emit({ type: "session_updated", summary: this.summary() });
	}
}
