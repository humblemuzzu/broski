/** What the frame mapper shows, routed: a subagent's events to its child session, the rest to the session (D20). */

import type { AgentEvent, SessionId } from "../../../contract";
import type { SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent, MappingPort } from "../ports/mapping";
import type { ChildRouter } from "./child-router";
import type { RunTracker } from "./run-tracker";

export interface MappedRoutingDeps {
	readonly mapping: MappingPort;
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly children: ChildRouter;
}

export class MappedRouting {
	private mapper: FrameMapper;

	constructor(
		private readonly deps: MappedRoutingDeps,
		sessionId: SessionId,
	) {
		this.mapper = deps.mapping.createMapper({ sessionId });
	}

	get current(): FrameMapper {
		return this.mapper;
	}

	emit(events: readonly MappedEvent[]): void {
		for (const mapped of events) {
			if (mapped.agentId !== undefined) this.deps.children.route(mapped);
			else this.deps.live.emit(this.asStopped(mapped.event), mapped.native);
		}
	}

	/** The conversation goes on under a new session id: what the old mapper held open closes, a fresh mapper starts. */
	restart(sessionId: SessionId): void {
		this.emit(this.mapper.settle("completed"));
		this.mapper = this.deps.mapping.createMapper({ sessionId });
	}

	/** A compaction the CLI reports failed while a Stop was asked for was stopped (it calls it "Request was aborted"). */
	private asStopped(event: AgentEvent): AgentEvent {
		if (event.type !== "compaction_finished" || event.outcome.kind !== "failed") return event;
		return this.deps.runs.current?.aborting ? { type: "compaction_finished", outcome: { kind: "aborted" } } : event;
	}
}
