import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AssistantMessage,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PiStreamMessage } from "../../types";

export type PiBridgeSyntheticEvent = {
	type: "__pi_bridge_stream__";
	streamMessage: PiStreamMessage;
};

/** Shape of tool result values with content array and optional details */
interface ToolResultValue {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
}

function isToolResultValue(value: unknown): value is ToolResultValue {
	if (value == null || typeof value !== "object") return false;
	return "content" in value && Array.isArray(value.content);
}

const extractText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const chunks: string[] = [];
	for (const item of content) {
		if (item == null || typeof item !== "object") continue;
		if (!("type" in item)) continue;
		if (item.type === "text" && "text" in item && typeof item.text === "string") {
			chunks.push(item.text);
		}
	}

	return chunks.join("");
};

const extractThinking = (content: unknown): string => {
	if (!Array.isArray(content)) return "";

	const chunks: string[] = [];
	for (const item of content) {
		if (item == null || typeof item !== "object") continue;
		if (!("type" in item)) continue;
		if (item.type === "thinking" && "thinking" in item && typeof item.thinking === "string") {
			chunks.push(item.thinking);
		}
	}

	return chunks.join("");
};

const extractToolCalls = (
	content: unknown,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> => {
	if (!Array.isArray(content)) return [];

	const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
	for (const item of content) {
		if (item == null || typeof item !== "object") continue;
		if (!("type" in item) || item.type !== "toolCall") continue;
		const tc = item as ToolCall;
		calls.push({
			id: String(tc.id ?? ""),
			name: String(tc.name ?? ""),
			arguments: tc.arguments,
		});
	}

	return calls;
};

const extractToolResultText = (value: unknown): { text: string | undefined; details?: unknown } => {
	if (isToolResultValue(value)) {
		const text = value.content
			.filter((c): c is TextContent => c != null && c.type === "text")
			.map((c) => c.text ?? "")
			.join("\n");
		return {
			text,
			details: value.details,
		};
	}

	if (typeof value === "string") {
		return { text: value };
	}

	return {
		text: value != null ? JSON.stringify(value) : undefined,
	};
};

/** Mapped message shape sent over the bridge wire */
interface MappedMessage {
	role: string;
	[key: string]: unknown;
}

export function mapAgentMessage(message: AgentMessage): MappedMessage | null {
	if (message.role === "system") return null;

	if (message.role === "user") {
		return {
			role: "user",
			content: extractText(message.content),
			timestamp: Number(message.timestamp ?? Date.now()),
		};
	}

	if (message.role === "assistant") {
		const assistant = message as AssistantMessage;
		return {
			role: "assistant",
			text: extractText(assistant.content),
			thinking: extractThinking(assistant.content),
			toolCalls: extractToolCalls(assistant.content),
			model: assistant.model,
			provider: assistant.provider,
			usage: assistant.usage,
			stopReason: assistant.stopReason,
			timestamp: Number(assistant.timestamp ?? Date.now()),
		};
	}

	if (message.role === "toolResult") {
		const toolResult = message as ToolResultMessage;
		return {
			role: "toolResult",
			toolCallId: toolResult.toolCallId,
			toolName: toolResult.toolName,
			content: extractText(toolResult.content),
			details: toolResult.details,
			isError: toolResult.isError,
			timestamp: Number(toolResult.timestamp ?? Date.now()),
		};
	}

	// Fallback for custom message types (bashExecution, custom, branchSummary, compactionSummary)
	const record = message as unknown as Record<string, unknown>;
	const summary = typeof record.summary === "string" ? record.summary : undefined;
	return {
		role: String(record.role ?? "unknown"),
		...record,
		// A summary marker carries its text in `summary`; the transcript renders `content`.
		...(summary === undefined ? {} : { content: summary }),
	};
}

export function mapAgentMessages(messages: AgentMessage[]): MappedMessage[] {
	const mapped: MappedMessage[] = [];
	for (const message of messages) {
		const entry = mapAgentMessage(message);
		if (entry) mapped.push(entry);
	}
	return mapped;
}

export function mapToolResult(message: ToolResultMessage): MappedMessage {
	return {
		role: "toolResult",
		toolCallId: message.toolCallId,
		toolName: message.toolName,
		content: extractText(message.content),
		details: message.details,
		isError: message.isError,
		timestamp: Number(message.timestamp ?? Date.now()),
	};
}

export function translateEvent(event: AgentSessionEvent | PiBridgeSyntheticEvent): PiStreamMessage | null {
	if ((event as PiBridgeSyntheticEvent).type === "__pi_bridge_stream__") {
		return (event as PiBridgeSyntheticEvent).streamMessage;
	}

	switch (event.type) {
		case "agent_start":
			return { type: "agent-start" };

		case "agent_end":
			if (event.willRetry) return null;
			return {
				type: "agent-end",
				messages: mapAgentMessages(event.messages),
			};

		case "agent_settled":
			return { type: "agent-settled", aborted: event.aborted };

		case "turn_start":
			return { type: "turn-start" };

		case "turn_end": {
			const message = mapAgentMessage(event.message);
			if (!message) return null;
			return {
				type: "turn-end",
				message,
				toolResults: event.toolResults.map(mapToolResult),
			};
		}

		case "message_start": {
			const message = mapAgentMessage(event.message);
			return message ? { type: "message-start", message } : null;
		}

		case "message_end": {
			const message = mapAgentMessage(event.message);
			return message ? { type: "message-end", message } : null;
		}

		case "session_info_changed":
			return { type: "session-info-changed", name: event.name ?? null };

		case "thinking_level_changed":
			return { type: "thinking-level-changed", level: event.level };

		case "summarization_retry_scheduled":
			return {
				type: "summarization-retry-scheduled",
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				errorMessage: event.errorMessage,
			};

		case "summarization_retry_finished":
			return { type: "summarization-retry-finished" };

		case "bash_execution_update":
			return { type: "bash-output", content: event.delta };

		case "message_update": {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent.type === "text_delta") {
				return { type: "text-delta", content: assistantEvent.delta };
			}

			if (assistantEvent.type === "thinking_delta") {
				return { type: "thinking-delta", content: assistantEvent.delta };
			}

			if (assistantEvent.type === "toolcall_start") {
				const content: TextContent | ThinkingContent | ToolCall | undefined =
					assistantEvent.partial?.content?.[assistantEvent.contentIndex];
				if (content?.type === "toolCall") {
					return {
						type: "tool-call-start",
						toolCallId: String(content.id ?? ""),
						toolName: String(content.name ?? ""),
						args: content.arguments,
					};
				}
			}

			if (assistantEvent.type === "toolcall_end") {
				return {
					type: "tool-call-args-done",
					toolCallId: assistantEvent.toolCall.id,
					toolName: assistantEvent.toolCall.name,
					args: assistantEvent.toolCall.arguments,
				};
			}

			if (assistantEvent.type === "done" || assistantEvent.type === "error") {
				return {
					type: "message-done",
					stopReason: String(assistantEvent.reason ?? "stop"),
				};
			}

			return null;
		}

		case "tool_execution_start":
			return {
				type: "tool-exec-start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};

		case "tool_execution_update": {
			const partial = extractToolResultText(event.partialResult);
			return {
				type: "tool-exec-update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: partial.text,
			};
		}

		case "tool_execution_end": {
			const result = extractToolResultText(event.result);
			return {
				type: "tool-exec-end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: result.text,
				details: result.details,
				isError: event.isError,
			};
		}

		case "compaction_start":
			return {
				type: "compaction-start",
				reason: event.reason,
			};

		case "compaction_end":
			return {
				type: "compaction-end",
				aborted: event.aborted,
				willRetry: event.willRetry,
				...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
			};

		case "auto_retry_start":
			return {
				type: "retry-start",
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				errorMessage: event.errorMessage,
			};

		case "auto_retry_end":
			return {
				type: "retry-end",
				success: event.success,
				attempt: event.attempt,
				...(event.finalError ? { finalError: event.finalError } : {}),
			};

		case "queue_update":
			return {
				type: "queue-update",
				steering: [...event.steering],
				followUp: [...event.followUp],
			};

		default:
			return null;
	}
}
