import {
	type AgentEvent,
	type AttachSync,
	applyEvent,
	EventEnvelope,
	type InteractionId,
	type OpenSession,
	type SessionRef,
	SessionSnapshot,
	type SinkRecord,
	type StreamPosition,
} from "../contract";
import type { CoreClient } from "./client";
import { EventLog, type ReplayWindow } from "./event-log";
import type { EncodedFrame } from "./frame";
import { withOlderView } from "./minor-views";
import type { CoreClock, CoreLog } from "./ports";
import { sameState } from "./same-state";
import { sessionKey, sessionLabel } from "./session-key";
import type { SessionSinkRouter } from "./session-sink";
import { fitEvent } from "./wire-fit";

const SinkRecordSchema = EventEnvelope.omit({ seq: true, session: true });

export interface LiveSessionDeps {
	readonly maxFrameBytes: number;
	readonly replay: ReplayWindow;
	readonly clock: CoreClock;
	readonly log: CoreLog;
	/** Called after each event reached every viewer; a viewer's link failing does not skip it (`CoreClient.send`). */
	readonly published: (live: LiveSession, event: AgentEvent) => void;
}

/**
 * One open session's stream: the `OpenSession`, the live state the contract's reducer builds from
 * its events, the `seq` each event gets, the replay log, and the clients viewing it. A stream has
 * its own epoch: a reopened session, a replaced one or a restarted bridge starts a new one.
 */
export class LiveSession {
	readonly key: string;
	readonly label: string;
	readonly epoch = crypto.randomUUID();
	readonly viewers = new Set<CoreClient>();
	/** Set once the hub has closed or retired the stream; records arriving later are dropped. */
	closed = false;
	cancelIdleClose: (() => void) | undefined;
	private seq = 0;
	private state: SessionSnapshot;
	private readonly log: EventLog;

	constructor(
		readonly ref: SessionRef,
		readonly open: OpenSession,
		snapshot: SessionSnapshot,
		readonly sink: SessionSinkRouter,
		private readonly deps: LiveSessionDeps,
		/** Interactions an answer is on its way to (first answer wins); a replacing stream shares them. */
		readonly claims = new Set<InteractionId>(),
	) {
		this.key = sessionKey(ref);
		this.label = sessionLabel(ref);
		this.state = snapshot;
		this.log = new EventLog(deps.replay);
	}

	get snapshot(): SessionSnapshot {
		return this.state;
	}

	/** One record from the adapter. An invalid one never reaches a phone; the adapter's own state replaces it. */
	receive(record: SinkRecord): void {
		if (this.closed) return;
		const checked = SinkRecordSchema.safeParse(record);
		if (checked.success) {
			this.publish(record);
			return;
		}
		this.deps.log.error(`[core] ${this.label}: dropped an event that breaks the contract: ${checked.error.message}`);
		this.resyncFromAdapter();
	}

	/**
	 * Checks the live state against the adapter's own (contract README §5, rule 2). They differ only
	 * when the adapter broke that rule; then the adapter's state wins, as a `resynced` every viewer applies.
	 */
	reconcile(): void {
		if (sameState(this.state, this.open.snapshot())) return;
		this.deps.log.error(`[core] ${this.label}: the adapter's snapshot differs from its events; resyncing`);
		this.resyncFromAdapter();
	}

	/** A replay from the log when `resume` is of this stream and the log reaches back to it, else the snapshot. */
	sync(resume: StreamPosition | undefined): { sync: AttachSync; replay: EncodedFrame[] } {
		if (resume?.epoch === this.epoch) {
			const replay = this.log.after(resume.seq, this.seq);
			if (replay) return { sync: { kind: "replay", epoch: this.epoch, afterSeq: resume.seq }, replay };
		}
		return { sync: { kind: "snapshot", epoch: this.epoch, lastSeq: this.seq, snapshot: this.state }, replay: [] };
	}

	private resyncFromAdapter(): void {
		const snapshot = this.open.snapshot();
		const checked = SessionSnapshot.safeParse(snapshot);
		if (!checked.success) {
			this.deps.log.error(
				`[core] ${this.label}: the adapter's snapshot breaks the contract too: ${checked.error.message}`,
			);
			return;
		}
		this.publish({ at: this.deps.clock.now(), event: { type: "resynced", snapshot } });
	}

	private publish(record: SinkRecord): void {
		this.state = applyEvent(this.state, record);
		this.seq += 1;
		const envelope: EventEnvelope = {
			session: this.ref,
			seq: this.seq,
			at: record.at,
			event: record.event,
			...(record.native !== undefined && { native: record.native }),
		};
		const fitted = fitEvent(envelope, this.state, this.deps.maxFrameBytes, this.deps.log);
		const frame = withOlderView(fitted, envelope, this.state, this.deps.maxFrameBytes, this.deps.log);
		this.log.push(this.seq, frame);
		for (const viewer of this.viewers) viewer.send(frame);
		this.deps.published(this, record.event);
	}
}
