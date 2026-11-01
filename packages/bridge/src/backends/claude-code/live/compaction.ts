/** Lane D · `compact`: `/compact <instructions>` sent as a prompt; the frames show it (Q13). */

import type { ActionResult } from "../../../contract";
import { notBuilt } from "../rejections";

export async function startCompaction(_instructions: string | undefined): Promise<ActionResult> {
	return notBuilt("lane D: compact");
}
