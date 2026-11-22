/** A session's totals and context fill as the contract's `Usage`, and the prompt cache its latest request left. */

import type { CacheWindow, Usage } from "../../../contract";
import type { PromptCache, SessionStats } from "../rpc/replies";

/** Anthropic's lifetimes in seconds, for an `anthropic` model Pi reports none of (pi-ai 1.5.2 `dist/cache-warming.js:22-33`). */
const ANTHROPIC_CACHE: PromptCache = { short: 300, long: 3600 };

/** A request that may have touched the cache: an assistant message, or a usage entry Pi wrote for a request of its own. */
export interface CacheRequest {
	readonly timestamp: number;
	readonly provider?: string | undefined;
	readonly usage?:
		| {
				readonly input: number;
				readonly cacheRead: number;
				readonly cacheWrite: number;
				readonly cacheWrite1h?: number;
		  }
		| undefined;
}

/**
 * Pi's totals (`get_session_stats`, pi-coding-agent 1.5.2 `docs/rpc-commands.md:526-567`) copied as they stand. Its
 * `tokens` has no reasoning count, so `reasoningTokens` is never set. A context fill Pi does not know (`tokens: null`
 * right after a compaction) is left out, never 0, so the previous fill does not outlive the compaction.
 */
export function usageOf(stats: SessionStats, cache?: CacheWindow): Usage {
	const context = stats.contextUsage;
	const usage: Usage = {};
	const { input, output, cacheRead, cacheWrite } = stats.tokens;
	if (isCount(input)) usage.inputTokens = input;
	if (isCount(output)) usage.outputTokens = output;
	if (isCount(cacheRead)) usage.cacheReadTokens = cacheRead;
	if (isCount(cacheWrite)) usage.cacheWriteTokens = cacheWrite;
	if (Number.isFinite(stats.cost) && stats.cost >= 0) usage.costUsd = stats.cost;
	if (context && context.tokens !== null && isCount(context.tokens) && isPositiveCount(context.contextWindow)) {
		usage.contextTokens = context.tokens;
		usage.contextWindow = context.contextWindow;
	}
	if (cache !== undefined) usage.cache = cache;
	return usage;
}

/**
 * The window a request left. `promptCache` is the model's (pi-ai 1.5.2 `dist/types.d.ts:673-674`); Anthropic's own
 * lifetimes stand in for an `anthropic` model Pi reports none of, and a model with neither gets no lifetime (GitHub
 * Copilot and MiniMax speak `anthropic-messages` without Anthropic's). Undefined for a request that touched no cache.
 */
export function cacheWindowOf(
	request: CacheRequest,
	previous?: CacheWindow,
	promptCache?: PromptCache,
): CacheWindow | undefined {
	const usage = request.usage;
	if (usage === undefined || !isCount(request.timestamp)) return undefined;
	const { input, cacheRead, cacheWrite } = usage;
	const long = usage.cacheWrite1h ?? 0;
	if (![input, cacheRead, cacheWrite, long].every(isCount) || cacheRead + cacheWrite === 0) return undefined;
	const tiers = promptCache ?? (request.provider === "anthropic" ? ANTHROPIC_CACHE : undefined);
	return {
		lastTouchAt: request.timestamp,
		...(tiers !== undefined && lifetime(tiers, cacheWrite, long, previous)),
		cachedTokens: cacheRead,
		promptTokens: input + cacheRead + cacheWrite,
	};
}

/**
 * A write's lifetime is its retention's tier, `long` for one written with long retention (`cacheWrite1h`), exactly
 * (pi-ai 1.5.2 `dist/cache-warming.js:26-33`). A request that only read the cache refreshed an entry an earlier one
 * wrote, whose retention it does not show: it keeps that one's lifetime, or the short one, estimated.
 */
function lifetime(
	tiers: PromptCache,
	cacheWrite: number,
	long: number,
	previous: CacheWindow | undefined,
): Pick<CacheWindow, "ttlMs" | "confidence"> {
	if (cacheWrite > 0) {
		const ttlMs = millis(long > 0 ? tiers.long : tiers.short);
		return ttlMs === undefined ? {} : { ttlMs, confidence: "exact" };
	}
	const ttlMs = previous?.ttlMs ?? millis(tiers.short);
	return ttlMs === undefined ? {} : { ttlMs, confidence: "estimated" };
}

function millis(seconds: number | undefined): number | undefined {
	const ms = seconds === undefined ? undefined : Math.round(seconds * 1000);
	return ms !== undefined && isPositiveCount(ms) ? ms : undefined;
}

/** What the contract's `z.int().nonnegative()` takes: Pi's numbers come from files and providers, so they are checked, not trusted. */
export function isCount(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveCount(value: number): boolean {
	return isCount(value) && value > 0;
}
