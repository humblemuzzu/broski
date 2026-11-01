/**
 * Work the backend's harness runs around a turn that is neither model text nor a tool call, such as a hook the user
 * configured. A later `activity` event with the same `id` replaces the entry (since 1.4).
 */

import { z } from "zod";
import { TranscriptItemId } from "./ids";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

export const ActivityStatus = z.enum(["running", "succeeded", "failed", "cancelled"]);
export type ActivityStatus = z.infer<typeof ActivityStatus>;

/** `label` is what ran, `detail` the occasion it ran on. */
export const Activity = z.strictObject({
	id: TranscriptItemId,
	label: z.string().min(1).max(MAX_NAME_CHARS),
	detail: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	status: ActivityStatus,
	output: z.string().max(MAX_TEXT_CHARS).optional(),
	durationMs: z.int().nonnegative().optional(),
});
export type Activity = z.infer<typeof Activity>;
