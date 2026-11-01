/** Lane B · one session's `FrameMapper`: dispatches each frame to the file that maps its kind. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FrameMapper, MappedEvent, MappingSeed } from "../ports/mapping";
import { MapperState } from "./state";

export function createFrameMapper(seed: MappingSeed): FrameMapper {
	const state = new MapperState(seed);
	return {
		map: (_frame: SDKMessage): readonly MappedEvent[] => [],
		noteSend: (uuid) => state.ownSends.add(uuid),
		settle: (_outcome): readonly MappedEvent[] => [],
	};
}
