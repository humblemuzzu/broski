/** Lane B · the `MappingPort` `backend.ts` hands the hosts (D) and the terminal tail (G). */

import type { MappingPort } from "../ports/mapping";
import { createFrameMapper } from "./mapper";
import { turnOutcome } from "./outcome";

export const CLAUDE_CODE_MAPPING: MappingPort = {
	createMapper: createFrameMapper,
	turnOutcome,
};
