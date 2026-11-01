/** Lane A · moving a transcript and its `<id>/` directory to the OS trash (D19, OQ5). */

import type { ActionResult } from "../../../contract";
import { notBuilt } from "../rejections";

export async function moveToTrash(_paths: readonly string[]): Promise<ActionResult> {
	return notBuilt("lane A: moveToTrash");
}
