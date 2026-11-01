/** Lane D · Stop (D8): `interruptQuery(query, {cancelQueued: true})`; queued input comes back as `input_returned`. */

import type { ActionResult } from "../../../contract";
import { notBuilt } from "../rejections";

export async function abortRun(): Promise<ActionResult> {
	return notBuilt("lane D: abort");
}
