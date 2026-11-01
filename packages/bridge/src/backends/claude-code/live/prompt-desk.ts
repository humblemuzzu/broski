/** Lane D · prompts: `start`, `steer` (`priority: "next"`), `queue` (D8), human-stamped with uuid = clientRequestId (D9, D37). */

import type { PromptInput, PromptResult } from "../../../contract";
import { notBuilt } from "../rejections";

export class PromptDesk {
	async prompt(_input: PromptInput): Promise<PromptResult> {
		return notBuilt("lane D: prompt");
	}
}
