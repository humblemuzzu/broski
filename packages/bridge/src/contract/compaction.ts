import { z } from "zod";
import { MAX_TEXT_CHARS } from "./limits";

/** `auto`: a context threshold. `overflow`: recovery after the context overflowed. */
export const CompactionTrigger = z.enum(["manual", "auto", "overflow"]);
export type CompactionTrigger = z.infer<typeof CompactionTrigger>;

export const CompactionCompleted = z.strictObject({
	kind: z.literal("completed"),
	tokensBefore: z.int().nonnegative().optional(),
	tokensAfter: z.int().nonnegative().optional(),
});
export type CompactionCompleted = z.infer<typeof CompactionCompleted>;

export const CompactionFailed = z.strictObject({ kind: z.literal("failed"), message: z.string().max(MAX_TEXT_CHARS) });
export type CompactionFailed = z.infer<typeof CompactionFailed>;

export const CompactionAborted = z.strictObject({ kind: z.literal("aborted") });
export type CompactionAborted = z.infer<typeof CompactionAborted>;

export const CompactionOutcome = z.discriminatedUnion("kind", [
	CompactionCompleted,
	CompactionFailed,
	CompactionAborted,
]);
export type CompactionOutcome = z.infer<typeof CompactionOutcome>;
