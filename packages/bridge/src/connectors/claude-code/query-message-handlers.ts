import type { SDKAssistantMessage, SDKToolProgressMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { emitSubagentInvocation, type QueryContext, type QueryEmit } from "./query-context";

/** Tool progress signals (long-running tools). */
export function handleToolProgress(message: SDKToolProgressMessage, emit: QueryEmit): void {
	emit({
		type: "tool-call",
		tool: message.tool_name,
		input: {
			elapsedSeconds: message.elapsed_time_seconds,
			// SDK 0.2.87: task_id for correlating progress to background agents
			...(message.task_id ? { taskId: message.task_id } : {}),
		},
		toolUseId: message.tool_use_id,
		status: "running",
	});
}

/** B9: SDKAssistantMessage.error — surface authentication/billing/rate errors. */
export function handleAssistantError(message: SDKAssistantMessage, emit: QueryEmit): void {
	emit({
		type: "assistant-error",
		errorType: String(message.error),
	});
}

/** Full assistant message (fallback if stream events are not emitted). */
export function handleAssistantFullMessage(message: SDKAssistantMessage, emit: QueryEmit): void {
	const content = message.message?.content || [];
	for (const block of content) {
		if (block?.type === "text") {
			emit({ type: "assistant-message", content: block.text ?? "" });
		} else if (block?.type === "tool_use") {
			const toolName = block.name as string;
			const toolInput = block.input as Record<string, unknown>;

			emit({
				type: "tool-call",
				tool: toolName,
				input: toolInput,
				toolUseId: block.id,
				status: "running",
			});

			emitSubagentInvocation(emit, toolName, toolInput, block.id);
		}
	}
}

/**
 * Tool results can surface as "user" messages with tool_result blocks. User
 * messages also carry checkpoint UUIDs when file checkpointing is enabled.
 */
export function handleUserMessage(ctx: QueryContext, message: SDKUserMessage, emit: QueryEmit): void {
	// Emit checkpoint if UUID is present (for file checkpointing/undo support)
	const checkpointUuid = message.uuid as string | undefined;
	if (checkpointUuid && ctx.sessionId) {
		emit({
			type: "checkpoint-created",
			sessionId: ctx.sessionId,
			checkpointUuid,
			timestamp: Date.now(),
		});
	}

	const content = message.message?.content || [];
	for (const block of content) {
		if (typeof block === "string") continue;
		if (block?.type === "tool_result") {
			emit({
				type: "tool-result",
				toolUseId: block.tool_use_id,
				result: block.content,
				toolUseResult: message.tool_use_result,
			});
		}
	}
}
