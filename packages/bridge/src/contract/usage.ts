import { z } from "zod";
import { Timestamp } from "./ids";

/** `exact` when the provider reported the cache write; `estimated` when it was inferred. */
export const CacheConfidence = z.enum(["exact", "estimated"]);
export type CacheConfidence = z.infer<typeof CacheConfidence>;

/**
 * The prompt cache as the latest model request left it. `lastTouchAt` is when that request wrote or refreshed it;
 * `ttlMs` its lifetime from then, absent when the provider publishes none. `cachedTokens` and `promptTokens` are the
 * latest request's own, not session totals.
 */
export const CacheWindow = z.strictObject({
	lastTouchAt: Timestamp,
	ttlMs: z.int().positive().optional(),
	confidence: CacheConfidence.optional(),
	cachedTokens: z.int().nonnegative().optional(),
	promptTokens: z.int().nonnegative().optional(),
});
export type CacheWindow = z.infer<typeof CacheWindow>;

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
	cache: CacheWindow.optional(),
});
export type Usage = z.infer<typeof Usage>;
