/** Lane D · the adapter-owned queue (D8): `queue_changed`, `cancelQueued`, sent when the run settles, returned on Stop. */

import type { ActionResult, QueueItem, QueueItemId } from "../../../contract";
import { notBuilt } from "../rejections";

export class InputQueue {
	items(): readonly QueueItem[] {
		return [];
	}

	cancel(_id: QueueItemId): ActionResult {
		return notBuilt("lane D: cancelQueued");
	}
}
