/** One session's `FrameMapper`: dispatches each frame to the file that maps its kind. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FrameMapper, MappedEvent, MappingSeed } from "../ports/mapping";
import { assistantEvents } from "./assistant";
import { rateLimitEvents } from "./extension-frames";
import { noticeEvent } from "./notices";
import { resultEvents } from "./result";
import { retractionEvents } from "./retraction";
import { retryEvents } from "./retry";
import { settleEvents } from "./settle";
import { MapperState } from "./state";
import { streamEvents } from "./stream-blocks";
import { systemEvents } from "./system-frames";
import { toolProgressEvents } from "./tool-calls";
import { userEvents } from "./user-input";

const FAULT_NOTICE = "Part of what Claude Code sent could not be shown.";

/** What a frame shows, in order. A frame type the SDK adds later has no case here and shows nothing. */
function frameEvents(state: MapperState, frame: SDKMessage): MappedEvent[] {
	switch (frame.type) {
		case "stream_event":
			return streamEvents(state, frame);
		case "assistant":
			return [...retractionEvents(state, frame), ...assistantEvents(state, frame)];
		case "user":
			return userEvents(state, frame);
		case "result":
			return resultEvents(state, frame);
		case "system":
			return [...retractionEvents(state, frame), ...systemEvents(state, frame)];
		case "tool_progress":
			return toolProgressEvents(state, frame);
		case "rate_limit_event":
			return rateLimitEvents(state, frame);
		case "conversation_reset":
		case "tool_use_summary":
		case "auth_status":
		case "prompt_suggestion":
			return [];
		default:
			return unreachable(frame);
	}
}

function unreachable(_frame: never): MappedEvent[] {
	return [];
}

/** A fault in the mapping is one notice, then silence: it never reaches the host as a throw. */
function guarded(state: MapperState, build: () => MappedEvent[]): MappedEvent[] {
	try {
		return build();
	} catch {
		if (state.faultReported) return [];
		state.faultReported = true;
		return [{ event: noticeEvent("warning", FAULT_NOTICE) }];
	}
}

export function createFrameMapper(seed: MappingSeed, now: () => number = Date.now): FrameMapper {
	const state = new MapperState(seed, now);
	return {
		map: (frame) => guarded(state, () => [...retryEvents(state, frame), ...frameEvents(state, frame)]),
		noteSend: (uuid) => state.ownSends.add(uuid),
		settle: (outcome) => guarded(state, () => settleEvents(state, outcome)),
	};
}
