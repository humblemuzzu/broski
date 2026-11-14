/** Live frames to contract events, as the hosts and the terminal tail call it. */

import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, NativeIds, RunOutcome, SessionId } from "../../../contract";

export interface MappingSeed {
	readonly sessionId: SessionId;
}

export interface MappedEvent {
	readonly event: AgentEvent;
	readonly native?: NativeIds;
	/** Set for an event of a subagent's own stream, which goes to its child session (D20). */
	readonly agentId?: string;
}

/** One session's mapping state, fed every frame of its process in order by the host that owns it. */
export interface FrameMapper {
	/** What a frame shows; never what the host owns (runs, own sends, asks, queue, model, mode). Never throws. */
	map(frame: SDKMessage): readonly MappedEvent[];
	noteSend(uuid: string): void;
	/** Finishes every block and tool still open. */
	settle(outcome: "completed" | "aborted"): readonly MappedEvent[];
}

export interface MappingPort {
	createMapper(seed: MappingSeed): FrameMapper;
	turnOutcome(result: SDKResultMessage): RunOutcome;
}
