/**
 * One hosted session's live state: every event any part of the adapter emits is applied here with the
 * contract's own reducer, then handed to the sink of the `OpenSession` attached now, if any. So
 * `snapshot()` is always the open snapshot plus the events since (contract README §5, rules 1-2).
 */

import {
	type AgentEvent,
	applyEvent,
	type NativeIds,
	type SessionSink,
	type SessionSnapshot,
	type SinkRecord,
} from "../../../contract";

export class LiveState {
	private state: SessionSnapshot;
	private sink: SessionSink | undefined;

	constructor(
		initial: SessionSnapshot,
		private readonly now: () => number,
	) {
		this.state = initial;
	}

	snapshot(): SessionSnapshot {
		return this.state;
	}

	/** Applies `event` and hands it to the attached sink, which never throws (README §5, rule 13). */
	emit(event: AgentEvent, native?: NativeIds): void {
		const record: SinkRecord = { at: this.now(), event, ...(native !== undefined && { native }) };
		this.state = applyEvent(this.state, record);
		this.sink?.emit(record);
	}

	/** From now on events reach `sink`; the snapshot returned is the state they apply on top of. */
	attach(sink: SessionSink): SessionSnapshot {
		this.sink = sink;
		return this.state;
	}

	/** Stops events reaching `sink`; a sink attached since is kept. */
	detach(sink: SessionSink): void {
		if (this.sink === sink) this.sink = undefined;
	}

	get attached(): boolean {
		return this.sink !== undefined;
	}
}
