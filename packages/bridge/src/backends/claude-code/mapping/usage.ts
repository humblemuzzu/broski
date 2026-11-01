/** Lane B · `usage_updated` from `result.modelUsage`/`total_cost_usd`, cumulative per process, never summed (fact 7). */

import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Usage } from "../../../contract";
import { isRecord } from "../json";

type ModelTotals = SDKResultMessage["modelUsage"][string];

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function sum(totals: readonly ModelTotals[], pick: (model: ModelTotals) => unknown): number {
	return totals.reduce((total, model) => total + count(pick(model)), 0);
}

/** The window of the session's own model, else of the only model used; none when several were used and none is the session's. */
function contextWindowOf(
	modelUsage: SDKResultMessage["modelUsage"],
	mainModel: string | undefined,
): number | undefined {
	const entries = Object.entries(modelUsage);
	const own = mainModel === undefined ? undefined : entries.find(([model]) => model === mainModel);
	const chosen = own ?? (entries.length === 1 ? entries[0] : undefined);
	const window = count(chosen?.[1].contextWindow);
	return window > 0 ? window : undefined;
}

/** The newest `message` iteration of the turn's last request: the context as the model saw it. */
function contextTokensOf(usage: SDKResultMessage["usage"]): number | undefined {
	const iterations: unknown = usage.iterations;
	if (!Array.isArray(iterations)) return undefined;
	for (let at = iterations.length - 1; at >= 0; at -= 1) {
		const iteration: unknown = iterations[at];
		if (!isRecord(iteration) || iteration.type !== "message") continue;
		return (
			count(iteration.input_tokens) +
			count(iteration.cache_read_input_tokens) +
			count(iteration.cache_creation_input_tokens)
		);
	}
	return undefined;
}

/**
 * `modelUsage` and `total_cost_usd` are the running totals of the whole process, subagents and compaction included
 * (`d.ts:5967-5977`); `usage` is the main loop's per turn and is not used for totals. A result with no model usage
 * is a zeroed crash or abort-before-any-request result and says nothing, so it yields nothing.
 */
export function usageOf(result: SDKResultMessage, mainModel?: string): Usage | undefined {
	const totals = Object.values(result.modelUsage);
	if (totals.length === 0) return undefined;
	const thinking = totals.filter((model) => typeof model.thinkingTokens === "number");
	const contextTokens = contextTokensOf(result.usage);
	const contextWindow = contextWindowOf(result.modelUsage, mainModel);
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
		...(contextWindow !== undefined && { contextWindow }),
	};
}
