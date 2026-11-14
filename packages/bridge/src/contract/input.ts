import { z } from "zod";
import { Attachment } from "./content";
import { ClientRequestId, CommandId, QueueItemId } from "./ids";
import { MAX_IMAGE_CHARS, MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "./limits";
import { Rejected } from "./rejection";

/**
 * `start` begins a run and is rejected while one is active. `steer` joins the active run at its next
 * safe boundary. `queue` is delivered when the agent would otherwise stop: the backend either goes on
 * with it in the same run or starts the next run with it. With no active run, `steer` and `queue`
 * start one.
 */
export const PromptMode = z.enum(["start", "steer", "queue"]);
export type PromptMode = z.infer<typeof PromptMode>;

export const PromptInput = z.strictObject({
	clientRequestId: ClientRequestId,
	mode: PromptMode,
	/** With `command` set, the command's arguments. */
	text: z.string().max(MAX_TEXT_CHARS),
	attachments: z.array(Attachment).max(MAX_LIST_ITEMS).refine(imagesFit, "the images are too large together"),
	command: CommandId.optional(),
});
export type PromptInput = z.infer<typeof PromptInput>;

function imagesFit(attachments: readonly Attachment[]): boolean {
	const chars = attachments.reduce((sum, item) => sum + (item.kind === "image" ? item.data.length : 0), 0);
	return chars <= MAX_IMAGE_CHARS;
}

/** `handled`: the backend consumed the input without a run, such as an extension command. */
export const PromptDisposition = z.enum(["started", "steered", "queued", "handled"]);
export type PromptDisposition = z.infer<typeof PromptDisposition>;

export const PromptAccepted = z.strictObject({
	status: z.literal("accepted"),
	disposition: PromptDisposition,
	queueItemId: QueueItemId.optional(),
});
export type PromptAccepted = z.infer<typeof PromptAccepted>;

export const PromptResult = z.discriminatedUnion("status", [PromptAccepted, Rejected]);
export type PromptResult = z.infer<typeof PromptResult>;

export const ActionAccepted = z.strictObject({ status: z.literal("accepted") });
export type ActionAccepted = z.infer<typeof ActionAccepted>;

export const ActionResult = z.discriminatedUnion("status", [ActionAccepted, Rejected]);
export type ActionResult = z.infer<typeof ActionResult>;
