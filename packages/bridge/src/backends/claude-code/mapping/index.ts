/** The `MappingPort` `backend.ts` hands the hosts and the terminal tail. */

import type { MappingPort } from "../ports/mapping";
import { createFrameMapper } from "./mapper";
import { turnOutcome } from "./outcome";

export const CLAUDE_CODE_MAPPING: MappingPort = {
	createMapper: createFrameMapper,
	turnOutcome,
};
