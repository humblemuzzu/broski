/** A session's totals and context fill as the contract's `Usage`, and the prompt cache its latest request left. */

import type { CacheWindow, Usage } from "../../../contract";
import type { AssistantMessage } from "../messages";
import type { SessionStats } from "../rpc/replies";

/** Anthropic's lifetimes for a short and a long retention write (pi-ai 1.5.2 `dist/cache-warming.js:22-33`). */
const SHORT_TTL_MS = 300_000;
const LONG_TTL_MS = 3_600_000;

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

function isAnthropic(message: AssistantMessage): boolean {
	return message.api === "anthropic-messages" || message.provider === "anthropic";
}

/**
 * Only Anthropic publishes how long a cache entry lives: an hour for one written with long retention
 * (`cacheWrite1h`), five minutes for one written without it. A request that only read the cache refreshed the entry
 * the previous request wrote, so it keeps that one's lifetime. Undefined for a request that touched no cache.
 */
export function cacheWindowOf(message: AssistantMessage, previous?: CacheWindow): CacheWindow | undefined {
	const usage = message.usage;
	if (usage === undefined || !isCount(message.timestamp)) return undefined;
	const { input, cacheRead, cacheWrite } = usage;
	const long = usage.cacheWrite1h ?? 0;
	if (![input, cacheRead, cacheWrite, long].every(isCount) || cacheRead + cacheWrite === 0) return undefined;
	const window: CacheWindow = {
		lastTouchAt: message.timestamp,
		cachedTokens: cacheRead,
		promptTokens: input + cacheRead + cacheWrite,
	};
	if (!isAnthropic(message)) return window;
	const ttlMs = long > 0 ? LONG_TTL_MS : cacheWrite > 0 ? SHORT_TTL_MS : (previous?.ttlMs ?? SHORT_TTL_MS);
	return { ...window, ttlMs, confidence: "exact" };
}

/** What the contract's `z.int().nonnegative()` takes: Pi's numbers come from files and providers, so they are checked, not trusted. */
export function isCount(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveCount(value: number): boolean {
	return isCount(value) && value > 0;
}
