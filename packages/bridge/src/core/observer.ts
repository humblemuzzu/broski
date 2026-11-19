import {
	type AgentBackend,
	type AgentEvent,
	type CatalogEvent,
	type SessionRef,
	type SessionSnapshot,
	SessionSummary,
	type SinkRecord,
	type Timestamp,
} from "../contract";
import { SESSION_CALL_DEADLINE_MS, settled, within } from "./deadline";
import type { LiveSession } from "./live-session";
import type { CoreClock, CoreLog } from "./ports";
import type { RunClock } from "./run-clock";
import { sessionLabel } from "./session-key";

/** One event of an open session, after every viewer has it. */
export interface ObservedEvent {
	readonly session: SessionRef;
	readonly at: Timestamp;
	readonly event: AgentEvent;
	/** The live state the event applied to, and the state it left. */
	readonly before: SessionSnapshot;
	readonly after: SessionSnapshot;
	/** The session's row as its backend gives it now; undefined when it gives none. Never throws. */
	describe(): Promise<SessionSummary | undefined>;
}

/**
 * Something outside the core that needs to know what every open session does, whether or not a
 * phone views it: the daemon's feed, which pushes when a run ends or an ask waits. It only
 * watches. Answering for a person goes through `BridgeCore.answer`, never through here.
 */
export interface CoreObserver {
	observe(observed: ObservedEvent): void;
	observeCatalog?(event: CatalogEvent): void;
}

/** Hands every event the hub published to the observer; a fault in the observer costs it that event and nothing else. */
export class Observation {
	constructor(
		private readonly observer: CoreObserver | undefined,
		private readonly backendOf: (ref: SessionRef) => AgentBackend | undefined,
		private readonly runClock: RunClock,
		private readonly clock: CoreClock,
		private readonly log: CoreLog,
	) {}

	publishCatalog(event: CatalogEvent): void {
		if (!this.observer?.observeCatalog) return;
		try {
			this.observer.observeCatalog(event);
		} catch (error) {
			this.log.error(`[core] the observer failed on catalog ${event.type}: ${String(error)}`);
		}
	}

	publish(live: LiveSession, record: SinkRecord, before: SessionSnapshot): void {
		if (!this.observer) return;
		const { at, event } = record;
		const observed: ObservedEvent = {
			session: live.ref,
			at,
			event,
			before,
			after: live.snapshot,
			describe: () => this.describe(live.ref),
		};
		try {
			this.observer.observe(observed);
		} catch (error) {
			this.log.error(`[core] ${sessionLabel(live.ref)}: the observer failed on ${event.type}: ${String(error)}`);
		}
	}

	private async describe(ref: SessionRef): Promise<SessionSummary | undefined> {
		const backend = this.backendOf(ref);
		if (!backend) return undefined;
		const read = settled(() => backend.getSession(ref));
		const outcome = await within(this.clock, SESSION_CALL_DEADLINE_MS, read, () => undefined);
		if (outcome === undefined) return undefined;
		if (!outcome.ok) {
			this.log.error(`[core] ${sessionLabel(ref)}: describing the session threw: ${outcome.thrown}`);
			return undefined;
		}
		if (outcome.value.status === "rejected") return undefined;
		const checked = SessionSummary.safeParse(outcome.value.summary);
		return checked.success ? this.runClock.enrich(checked.data) : undefined;
	}
}
