/** `usage_updated` from `result.modelUsage`/`total_cost_usd`, cumulative per process, never summed (D14). */

import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CacheWindow, Timestamp, Usage } from "../../../contract";
import { isRecord } from "../json";

type ModelTotals = SDKResultMessage["modelUsage"][string];

/** Anthropic's prompt cache lifetimes: a five-minute and a one-hour write. */
const SHORT_TTL_MS = 300_000;
const LONG_TTL_MS = 3_600_000;

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function sum(totals: readonly ModelTotals[], pick: (model: ModelTotals) => unknown): number {
	return totals.reduce((total, model) => total + count(pick(model)), 0);
}

/** The session's own model, else the only model used; none when several were used and none is the session's. */
function ownModelOf(
	modelUsage: SDKResultMessage["modelUsage"],
	mainModel: string | undefined,
): ModelTotals | undefined {
	const entries = Object.entries(modelUsage);
	const own = mainModel === undefined ? undefined : entries.find(([model]) => model === mainModel);
	return (own ?? (entries.length === 1 ? entries[0] : undefined))?.[1];
}

/** The newest `message` iteration of the turn's last request: the context as the model saw it. */
function latestRequestOf(usage: SDKResultMessage["usage"]): Record<string, unknown> | undefined {
	const iterations: unknown = usage.iterations;
	if (!Array.isArray(iterations)) return undefined;
	for (let at = iterations.length - 1; at >= 0; at -= 1) {
		const iteration: unknown = iterations[at];
		if (isRecord(iteration) && iteration.type === "message") return iteration;
	}
	return undefined;
}

/** A request's tokens, or the turn's when `usage` is the turn's whole `result.usage`. */
function requestTokensOf(usage: Readonly<Record<string, unknown>>) {
	const written = isRecord(usage.cache_creation) ? usage.cache_creation : {};
	return {
		input: count(usage.input_tokens),
		read: count(usage.cache_read_input_tokens),
		write: count(usage.cache_creation_input_tokens),
		write1h: count(written.ephemeral_1h_input_tokens),
		write5m: count(written.ephemeral_5m_input_tokens),
	};
}

/**
 * A request that only read the cache refreshed what earlier requests wrote: an hour when the model has only ever
 * written one-hour entries, else the shorter lifetime, which never shows a cold cache as warm.
 */
function refreshedTtlOf(own: ModelTotals | undefined): number {
	const long = count(own?.cacheCreationEphemeral1hInputTokens);
	return long > 0 && count(own?.cacheCreationEphemeral5mInputTokens) === 0 ? LONG_TTL_MS : SHORT_TTL_MS;
}

/**
 * How long the request kept the cache: `exact` only when the provider broke its write down by lifetime. Five-minute
 * entries outlive no one-hour countdown, so they win when both were written; a write not broken down, or a read that
 * only refreshed earlier entries, is `estimated`.
 */
function lifetimeOf(
	tokens: ReturnType<typeof requestTokensOf>,
	own: ModelTotals | undefined,
): Pick<CacheWindow, "ttlMs" | "confidence"> {
	if (tokens.write5m > 0) return { ttlMs: SHORT_TTL_MS, confidence: "exact" };
	if (tokens.write1h > 0) return { ttlMs: LONG_TTL_MS, confidence: "exact" };
	return { ttlMs: tokens.write > 0 ? SHORT_TTL_MS : refreshedTtlOf(own), confidence: "estimated" };
}

/**
 * The prompt cache the turn's last request left, touched `at`. Its own hit is known from the newest `message`
 * iteration; without one, only the turn's `result.usage` says whether and how long the cache was written. Undefined for
 * a turn that touched no cache.
 */
function cacheWindowOf(
	turn: SDKResultMessage["usage"],
	latest: Readonly<Record<string, unknown>> | undefined,
	own: ModelTotals | undefined,
	at: Timestamp,
): CacheWindow | undefined {
	const tokens = requestTokensOf(latest ?? turn);
	if (tokens.read + tokens.write === 0) return undefined;
	return {
		lastTouchAt: at,
		...lifetimeOf(tokens, own),
		...(latest !== undefined && {
			cachedTokens: tokens.read,
			promptTokens: tokens.input + tokens.read + tokens.write,
		}),
	};
}

/**
 * `modelUsage` and `total_cost_usd` are the running totals of the whole process, subagents and compaction included
 * (`SDKResultSuccess.modelUsage`); `usage` is the main loop's per turn and is not used for totals. A result with no model usage
 * is a zeroed crash or abort-before-any-request result and says nothing, so it yields nothing. `at` is when the turn's
 * last request touched the cache.
 */
export function usageOf(result: SDKResultMessage, mainModel: string | undefined, at: Timestamp): Usage | undefined {
	const totals = Object.values(result.modelUsage);
	if (totals.length === 0) return undefined;
	const thinking = totals.filter((model) => typeof model.thinkingTokens === "number");
	const latest = latestRequestOf(result.usage);
	const contextTokens = latest === undefined ? undefined : contextTokensOf(latest);
	const own = ownModelOf(result.modelUsage, mainModel);
	const contextWindow = count(own?.contextWindow);
	const cache = cacheWindowOf(result.usage, latest, own, at);
	const cost = result.total_cost_usd;
	return {
		inputTokens: sum(totals, (model) => model.inputTokens),
		outputTokens: sum(totals, (model) => model.outputTokens),
		cacheReadTokens: sum(totals, (model) => model.cacheReadInputTokens),
		cacheWriteTokens: sum(totals, (model) => model.cacheCreationInputTokens),
		...(thinking.length > 0 && {
			reasoningTokens: sum(thinking, (model) => model.thinkingTokens),
		}),
		...(Number.isFinite(cost) && cost >= 0 && { costUsd: cost }),
		...(contextTokens !== undefined && { contextTokens }),
		...(contextWindow > 0 && { contextWindow }),
		...(cache !== undefined && { cache }),
	};
}

function contextTokensOf(request: Readonly<Record<string, unknown>>): number {
	const { input, read, write } = requestTokensOf(request);
	return input + read + write;
}
