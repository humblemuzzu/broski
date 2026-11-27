/**
 * A live session's `Usage`: the context fill from `usage_update {used, size}`, and the prompt cache as the latest turn
 * left it, from the token counts on that turn's `session/prompt` answer.
 *
 * The session totals (`inputTokens`, `outputTokens`, `cacheReadTokens`, `reasoningTokens`) stay absent: agy gives one
 * turn's counts, and the bridge sees only the turns it ran, so a sum of them would read as the session's whole use
 * while it leaves out every turn run elsewhere or before the bridge started.
 */

import type { Usage } from "../../../contract";
import type { TurnUsage } from "../acp/frames";

/** `usage` with the context fill agy reported: `usage` itself when that is what it already holds. */
export function withContext(usage: Usage | undefined, used: number, size: number): Usage | undefined {
	const contextTokens = Number.isSafeInteger(used) && used >= 0 ? used : usage?.contextTokens;
	const contextWindow = Number.isSafeInteger(size) && size > 0 ? size : usage?.contextWindow;
	if (contextTokens === usage?.contextTokens && contextWindow === usage?.contextWindow) return usage;
	return {
		...usage,
		...(contextTokens !== undefined && { contextTokens }),
		...(contextWindow !== undefined && { contextWindow }),
	};
}

/**
 * The turn's cache window, or `usage` as it was when the turn named no cache read. The schema leaves open whether
 * `inputTokens` holds the cached reads (Gemini's prompt count does, Anthropic's does not); its `totalTokens` is "the sum
 * of all token types", so a total that the input, output and thought counts already make means the input holds them.
 */
export function withTurnCache(usage: Usage | undefined, turn: TurnUsage, at: number): Usage | undefined {
	const { inputTokens, cachedReadTokens } = turn;
	if (inputTokens === undefined || cachedReadTokens === undefined) return usage;
	const withoutCache = inputTokens + (turn.outputTokens ?? 0) + (turn.thoughtTokens ?? 0);
	const inputHoldsCache = turn.totalTokens !== undefined && turn.totalTokens === withoutCache;
	const promptTokens = inputHoldsCache ? inputTokens : inputTokens + cachedReadTokens;
	return {
		...usage,
		cache: {
			lastTouchAt: at,
			confidence: "exact",
			cachedTokens: Math.min(cachedReadTokens, promptTokens),
			promptTokens,
		},
	};
}
