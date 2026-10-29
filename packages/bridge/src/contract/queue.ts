import { z } from "zod";
import { ClientRequestId, QueueItemId } from "./ids";
import { MAX_TEXT_CHARS } from "./limits";

export const QueuedDelivery = z.enum(["steer", "queue"]);
export type QueuedDelivery = z.infer<typeof QueuedDelivery>;

/** Input accepted but not yet delivered to the model, including backend control items such as a pending compaction. */
export const QueueItem = z.strictObject({
	id: QueueItemId,
	delivery: QueuedDelivery,
	preview: z.string().max(MAX_TEXT_CHARS),
	clientRequestId: ClientRequestId.optional(),
});
export type QueueItem = z.infer<typeof QueueItem>;
