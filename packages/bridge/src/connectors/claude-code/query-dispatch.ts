import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryContext, QueryEmit } from "./query-context";
import {
	handleAssistantError,
	handleAssistantFullMessage,
	handleToolProgress,
	handleUserMessage,
} from "./query-message-handlers";
import { handleResultMessage } from "./query-result-handlers";
import { handleStreamEvent } from "./query-stream-handlers";
import { handleCompactBoundary, handleSystemInit } from "./query-system-handlers";
import { emitClaudeCodeSupplementalStreamEvents, type SupplementalEventResult } from "./stream-supplemental-events";

export async function handleQueryMessage(
	ctx: QueryContext,
	message: SDKMessage,
	emit: QueryEmit,
): Promise<SupplementalEventResult> {
	if (message?.type === "system" && message?.subtype === "init") {
		await handleSystemInit(ctx, message, emit);
	}

	if (message?.type === "system" && message?.subtype === "compact_boundary") {
		handleCompactBoundary(message, emit);
	}

	if (message?.type === "stream_event" && message?.event) {
		handleStreamEvent(ctx, message, emit);
	}

	if (message?.type === "tool_progress") {
		handleToolProgress(message, emit);
	}

	if (message?.type === "assistant" && message?.error) {
		handleAssistantError(message, emit);
	}

	if (!ctx.sawStreamEvents && message?.type === "assistant") {
		handleAssistantFullMessage(message, emit);
	}

	if (message?.type === "user") {
		handleUserMessage(ctx, message, emit);
	}

	if (message?.type === "result") {
		handleResultMessage(ctx, message, emit);
	}

	return emitClaudeCodeSupplementalStreamEvents(message, emit, ctx.onError);
}
