/**
 * Lane B · D50: where a frame's events go. A main-thread frame goes to the session's own stream. A subagent's frame
 * goes to the subagent's child stream (`agentId`, D20) and, while the tool call that runs the subagent is open, to
 * every stream that call is shown in, nested under it with `parentToolCallId`.
 */

import type { AgentEvent, ToolCallId } from "../../../contract";
import { childRef } from "../ids";
import type { MappedEvent } from "../ports/mapping";
import { MAIN, type MapperState } from "./state";
import { wireId, wireToolCallId } from "./wire-id";

/** What a frame says about who produced it (`agent_id`, `parent_tool_use_id`). */
export interface Producer {
	readonly agentId: string | undefined;
	readonly parentToolUseId: string | null | undefined;
}

export interface Placement {
	/** Stream keys (`MAIN` or an agent id) the frame's events go to; empty when the frame has nowhere to go. */
	readonly streams: readonly string[];
	/** The open tool call the producer runs under, which the events nest under in the streams it is shown in. */
	readonly parent: ToolCallId | undefined;
	readonly own: string | undefined;
}

export function placementOf(state: MapperState, producer: Producer): Placement {
	const { agentId, parentToolUseId } = producer;
	if (agentId === undefined && (parentToolUseId === null || parentToolUseId === undefined)) {
		return { streams: [MAIN], parent: undefined, own: undefined };
	}
	const agent = wireId(agentId);
	const own = agent !== undefined && childRef(state.seed.sessionId, agent) !== undefined ? agent : undefined;
	const parentId = wireToolCallId(parentToolUseId);
	const parent = parentId === undefined ? undefined : state.openTools.get(parentId);
	const streams = [...new Set([...(own === undefined ? [] : [own]), ...(parent?.streams ?? [])])];
	return { streams, parent: parent === undefined ? undefined : parentId, own };
}

/** The tool call nests under its producer in every stream but the producer's own. */
export function nestsIn(placement: Placement, stream: string): boolean {
	return placement.parent !== undefined && stream !== placement.own;
}

/** One event per stream, each built by `build(stream)`. */
export function fanOut(streams: readonly string[], build: (stream: string) => AgentEvent): MappedEvent[] {
	return streams.map((stream) =>
		stream === MAIN ? { event: build(stream) } : { event: build(stream), agentId: stream },
	);
}
