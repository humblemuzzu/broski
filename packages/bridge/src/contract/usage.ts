import { z } from "zod";

/** Session totals as the backend reports them, and the context window fill. A field the backend does not report is absent. */
export const Usage = z.strictObject({
	inputTokens: z.int().nonnegative().optional(),
	outputTokens: z.int().nonnegative().optional(),
	cacheReadTokens: z.int().nonnegative().optional(),
	cacheWriteTokens: z.int().nonnegative().optional(),
	reasoningTokens: z.int().nonnegative().optional(),
	costUsd: z.number().nonnegative().optional(),
	contextTokens: z.int().nonnegative().optional(),
	contextWindow: z.int().positive().optional(),
});
export type Usage = z.infer<typeof Usage>;
