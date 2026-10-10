import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { normalizeModelUsage, normalizePermissionDenials, pickContextWindow } from "./capabilities";
import type { QueryContext, QueryEmit } from "./query-context";

type ResultUsage = NonNullable<SDKResultMessage["usage"]>;

function extractLastIterationContextTokens(iterations: ResultUsage["iterations"]): number | undefined {
	if (!Array.isArray(iterations) || iterations.length === 0) return undefined;

	// Walk backwards to find the last message-type iteration (skip compaction iterations).
	// usage.iterations has per-API-call breakdowns; the last 'message' iteration reflects
	// the actual current context window occupancy, NOT cumulative totals.
	// See: https://docs.anthropic.com/en/docs/about-claude/models (iterations field)
	for (let i = iterations.length - 1; i >= 0; i--) {
		const iter = iterations[i];
		if (iter && iter.type === "message") {
			return (iter.input_tokens ?? 0) + (iter.cache_read_input_tokens ?? 0) + (iter.cache_creation_input_tokens ?? 0);
		}
	}
	return undefined;
}

function buildTokenUsageEvent(
	ctx: QueryContext,
	usage: ResultUsage,
	totalCostUsd: number | undefined,
	rawModelUsage: unknown,
): Record<string, unknown> {
	const modelUsage = normalizeModelUsage(rawModelUsage);
	const contextWindow = pickContextWindow(modelUsage, ctx.sdkOptions.model);
	const lastIterContextTokens = extractLastIterationContextTokens(usage.iterations);

	return {
		type: "token-usage",
		usage: {
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cacheReadTokens: usage.cache_read_input_tokens,
			cacheCreationTokens: usage.cache_creation_input_tokens,
			...(typeof contextWindow === "number" ? { contextWindow } : {}),
			// Per-turn context tokens from last iteration (actual window occupancy)
			...(typeof lastIterContextTokens === "number" ? { lastIterContextTokens } : {}),
			// SDK newer usage fields
			...(usage.cache_creation != null
				? {
						cacheCreation: {
							ephemeral1hInputTokens: usage.cache_creation.ephemeral_1h_input_tokens,
							ephemeral5mInputTokens: usage.cache_creation.ephemeral_5m_input_tokens,
						},
					}
				: {}),
			...(usage.inference_geo != null ? { inferenceGeo: usage.inference_geo } : {}),
			...(usage.server_tool_use != null
				? {
						serverToolUse: {
							webFetchRequests: usage.server_tool_use.web_fetch_requests,
							webSearchRequests: usage.server_tool_use.web_search_requests,
						},
					}
				: {}),
			...(usage.service_tier != null ? { serviceTier: usage.service_tier } : {}),
		},
		// CC SDK: total_cost_usd is on the result message itself, NOT inside usage.
		// SDKResultSuccess/SDKResultError both have top-level total_cost_usd.
		totalCostUsd,
		...(modelUsage ? { modelUsage } : {}),
	};
}

function buildResultCompleteEvent(message: SDKResultMessage): Record<string, unknown> {
	const errors =
		"errors" in message && Array.isArray(message.errors)
			? message.errors.filter((err: unknown): err is string => typeof err === "string")
			: [];
	const permissionDenials = normalizePermissionDenials(message.permission_denials);

	// B10: emit result-complete with stop_reason + subtype/error metadata
	return {
		type: "result-complete",
		stopReason: message.stop_reason ?? null,
		numTurns: typeof message.num_turns === "number" ? message.num_turns : undefined,
		durationMs: typeof message.duration_ms === "number" ? message.duration_ms : undefined,
		durationApiMs: typeof message.duration_api_ms === "number" ? message.duration_api_ms : undefined,
		subtype: typeof message.subtype === "string" ? message.subtype : undefined,
		isError: typeof message.is_error === "boolean" ? message.is_error : undefined,
		...(errors.length > 0 ? { errors } : {}),
		...(permissionDenials ? { permissionDenials } : {}),
		...(typeof message.fast_mode_state === "string" ? { fastModeState: message.fast_mode_state } : {}),
		// SDK 0.2.92: terminal reason + deferred tool use
		...(typeof message.terminal_reason === "string" ? { terminalReason: message.terminal_reason } : {}),
		...("deferred_tool_use" in message && message.deferred_tool_use
			? { deferredToolUse: message.deferred_tool_use }
			: {}),
	};
}

/** Result / token usage + cost (end of conversation - cumulative totals). */
export function handleResultMessage(ctx: QueryContext, message: SDKResultMessage, emit: QueryEmit): void {
	if ("result" in message && typeof message.result === "string" && message.result.trim().length > 0) {
		emit({ type: "assistant-message", content: message.result });
	}
	if (message.usage) {
		emit(buildTokenUsageEvent(ctx, message.usage, message.total_cost_usd, message.modelUsage));
	}

	emit(buildResultCompleteEvent(message));

	if ("structured_output" in message && message.structured_output !== undefined) {
		emit({
			type: "structured-output",
			data: message.structured_output,
		});
	}
}
