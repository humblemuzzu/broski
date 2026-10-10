import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { emitSubagentInvocation, type QueryContext, type QueryEmit } from "./query-context";

type StreamEvent = SDKPartialAssistantMessage["event"];
type ContentBlockStartEvent = Extract<StreamEvent, { type: "content_block_start" }>;
type ContentBlockDeltaEvent = Extract<StreamEvent, { type: "content_block_delta" }>;
type ContentBlockStopEvent = Extract<StreamEvent, { type: "content_block_stop" }>;

// Stream events are preferred for real-time deltas (avoids double-emitting full assistant blocks).
export function handleStreamEvent(ctx: QueryContext, message: SDKPartialAssistantMessage, emit: QueryEmit): void {
	ctx.sawStreamEvents = true;
	const event = message.event;

	if (event.type === "content_block_start") {
		handleContentBlockStart(ctx, event, emit);
	}
	if (event.type === "content_block_delta") {
		handleContentBlockDelta(ctx, event, emit);
	}
	if (event.type === "content_block_stop") {
		handleContentBlockStop(ctx, event);
	}
}

function handleContentBlockStart(ctx: QueryContext, event: ContentBlockStartEvent, emit: QueryEmit): void {
	const block = event.content_block;
	const index = event.index;
	if (block?.type === "text" && typeof block?.text === "string" && block.text.length > 0) {
		emit({ type: "assistant-message-delta", content: block.text });
	}
	if (block?.type === "tool_use") {
		const toolName = block.name as string;
		const toolInput = block.input as Record<string, unknown>;
		const toolUseId = block.id as string | undefined;

		if (typeof index === "number" && toolUseId) {
			ctx.toolUseIdByStreamIndex.set(index, toolUseId);
		}
		if (toolUseId) {
			ctx.toolNameByToolUseId.set(toolUseId, toolName);
			ctx.toolInputJsonBufferByToolUseId.delete(toolUseId);
		}

		emit({
			type: "tool-call",
			tool: toolName,
			input: toolInput,
			toolUseId,
			status: "running",
		});

		emitSubagentInvocation(emit, toolName, toolInput, toolUseId);
	}
}

function handleContentBlockDelta(ctx: QueryContext, event: ContentBlockDeltaEvent, emit: QueryEmit): void {
	const delta = event.delta;
	const deltaType = delta.type as string; // widen for forward-compat (e.g. reasoning_delta)
	if (deltaType === "text_delta" && "text" in delta && typeof delta.text === "string") {
		emit({ type: "assistant-message-delta", content: delta.text });
	} else if (
		(deltaType === "thinking_delta" || deltaType === "reasoning_delta") &&
		"thinking" in delta &&
		typeof delta.thinking === "string"
	) {
		emit({
			type: "thinking-delta",
			content: delta.thinking,
			partId: `thinking_${event.index}`,
		});
	} else if (deltaType === "input_json_delta" && "partial_json" in delta && typeof delta.partial_json === "string") {
		emitPartialJsonToolCall(ctx, event.index, delta.partial_json, emit);
	}
}

function emitPartialJsonToolCall(
	ctx: QueryContext,
	index: number | undefined,
	partialJson: string,
	emit: QueryEmit,
): void {
	const toolUseId = typeof index === "number" ? ctx.toolUseIdByStreamIndex.get(index) : undefined;
	if (!toolUseId) return;

	const nextJson = `${ctx.toolInputJsonBufferByToolUseId.get(toolUseId) ?? ""}${partialJson}`;
	ctx.toolInputJsonBufferByToolUseId.set(toolUseId, nextJson);

	let parsedInput: Record<string, unknown> | undefined;
	try {
		const parsed = JSON.parse(nextJson);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			parsedInput = parsed as Record<string, unknown>;
		}
	} catch {
		// partial JSON not complete yet — keep buffering
	}

	const toolName = ctx.toolNameByToolUseId.get(toolUseId) ?? "tool";
	emit({
		type: "tool-call",
		tool: toolName,
		input: parsedInput ?? { _partialJson: nextJson },
		toolUseId,
		status: "running",
	});
}

function handleContentBlockStop(ctx: QueryContext, event: ContentBlockStopEvent): void {
	const index = event.index as number | undefined;
	if (typeof index === "number") {
		const toolUseId = ctx.toolUseIdByStreamIndex.get(index);
		if (toolUseId) {
			ctx.toolInputJsonBufferByToolUseId.delete(toolUseId);
			ctx.toolUseIdByStreamIndex.delete(index);
		}
	}
}
