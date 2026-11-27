/**
 * What agy reported of two like turns' tokens, side by side, for a person to judge `backends/antigravity/live/usage.ts`
 * by: whether a turn's counts are its own or the session's so far (two like turns then report about the same output,
 * or the second about twice the first), and whether `inputTokens` already holds the cached reads (agy's `totalTokens`
 * then equals input + output + thought). The checks are only what holds either way: each turn carried its counts, the
 * context fill is agy's last `usage_update`, and the cache window is one of the two readings of the last turn.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import { type Exchange, type Frame, resultOf, updateOf } from "./wire-log";

interface TurnTokens {
	readonly input?: number;
	readonly output?: number;
	readonly thought?: number;
	readonly cachedRead?: number;
	readonly total?: number;
}

export interface UsageReport {
	readonly text: string;
	readonly turnsWithUsage: number;
	readonly contextMatches: boolean;
	readonly cacheMatchesARule: boolean;
}

function count(fields: Readonly<Record<string, unknown>>, key: string): number | undefined {
	const value = fields[key];
	return typeof value === "number" ? value : undefined;
}

function tokensOf(exchange: Exchange): TurnTokens | undefined {
	const usage = resultOf(exchange.answer)?.usage;
	if (!isRecord(usage)) return undefined;
	const tokens = {
		input: count(usage, "inputTokens"),
		output: count(usage, "outputTokens"),
		thought: count(usage, "thoughtTokens"),
		cachedRead: count(usage, "cachedReadTokens"),
		total: count(usage, "totalTokens"),
	};
	return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined));
}

function line(label: string, tokens: TurnTokens | undefined): string {
	if (tokens === undefined) return `${label}: no usage`;
	const { input, output, thought, cachedRead, total } = tokens;
	const sum = (input ?? 0) + (output ?? 0) + (thought ?? 0);
	const holds =
		total === undefined ? "no total" : total === sum ? "total = in+out+thought" : `total ≠ in+out+thought (${sum})`;
	return `${label}: in ${input} out ${output} thought ${thought} cachedRead ${cachedRead} total ${total}; ${holds}`;
}

export function usageReport(
	turns: readonly Exchange[],
	updates: readonly { readonly frame: Frame }[],
	live: LiveSession,
): UsageReport {
	const tokens = turns.map(tokensOf);
	const usage = live.session.snapshot().usage;
	const context = updates
		.map(({ frame }) => updateOf(frame))
		.findLast((update) => update?.sessionUpdate === "usage_update");
	const used = context === undefined ? undefined : count(context, "used");
	const size = context === undefined ? undefined : count(context, "size");
	const last = tokens.at(-1);
	const readings =
		last?.input === undefined || last.cachedRead === undefined ? [] : [last.input, last.input + last.cachedRead];
	const cache = usage?.cache;
	const cacheMatchesARule =
		readings.length === 0 ||
		(cache?.promptTokens !== undefined &&
			readings.includes(cache.promptTokens) &&
			cache.cachedTokens === Math.min(last?.cachedRead ?? 0, cache.promptTokens));
	const [first, second] = tokens;
	const ratio = first?.output && second?.output !== undefined ? (second.output / first.output).toFixed(2) : "?";
	const text = [
		"agy's token counts for two like turns:",
		line("  turn 1", first),
		line("  turn 2", second),
		`  turn 2's output is ${ratio}× turn 1's (about 1 means per-turn counts, about 2 a running total)`,
		`  last usage_update: used ${used} of ${size}; the snapshot shows ${usage?.contextTokens} of ${usage?.contextWindow}`,
		`  cache window: ${cache === undefined ? "none" : `cached ${cache.cachedTokens} of prompt ${cache.promptTokens}`}`,
	].join("\n");
	return {
		text,
		turnsWithUsage: tokens.filter((turn) => turn?.input !== undefined).length,
		contextMatches: used !== undefined && usage?.contextTokens === used && usage.contextWindow === size,
		cacheMatchesARule,
	};
}
