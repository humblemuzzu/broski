/** A session's totals and context fill as the contract's `Usage`. */

import type { Usage } from "../../../contract";
import type { SessionStats } from "../rpc/replies";

/**
 * Pi's totals (`get_session_stats`, pi-coding-agent 1.5.2 `docs/rpc-commands.md:526-567`) copied as they stand. Its
 * `tokens` has no reasoning count, so `reasoningTokens` is never set. A context fill Pi does not know (`tokens: null`
 * right after a compaction) is left out, never 0, so the previous fill does not outlive the compaction.
 */
export function usageOf(stats: SessionStats): Usage {
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
	return usage;
}

/** What the contract's `z.int().nonnegative()` takes: Pi's numbers come from files and providers, so they are checked, not trusted. */
export function isCount(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveCount(value: number): boolean {
	return isCount(value) && value > 0;
}
