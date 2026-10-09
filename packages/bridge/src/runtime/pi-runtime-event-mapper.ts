import type { PiStreamMessage } from "../types/pi";
import type { BroskiBackendData, BroskiRuntimeEvent } from "../types/runtime";
import { enrichRuntimeEvent } from "./stream-contract";

type PiRuntimeEventContext = {
	backend: "pi";
	sessionId?: string;
	cwd?: string;
};

const baseEvent = <TType extends BroskiRuntimeEvent["type"]>(
	type: TType,
	ctx: PiRuntimeEventContext,
	backendData?: BroskiBackendData,
) =>
	enrichRuntimeEvent({
		type,
		backend: ctx.backend,
		timestampMs: Date.now(),
		...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
		...(ctx.cwd ? { cwd: ctx.cwd } : {}),
		...(backendData ? { backendData } : {}),
	} as Extract<BroskiRuntimeEvent, { type: TType }>);

export function mapPiStreamToRuntimeEvent(
	piEvent: PiStreamMessage,
	ctx: PiRuntimeEventContext,
): BroskiRuntimeEvent | null {
	switch (piEvent.type) {
		case "agent-start":
			return baseEvent("agent_started", ctx, { sourceType: piEvent.type });

		case "agent-end":
			return {
				...baseEvent("agent_finished", ctx, {
					sourceType: piEvent.type,
					messages: piEvent.messages,
				}),
			};

		case "agent-settled":
			return baseEvent("agent_finished", ctx, {
				sourceType: piEvent.type,
				aborted: piEvent.aborted,
			});

		case "text-delta":
			return {
				...baseEvent("assistant_text_delta", ctx, { sourceType: piEvent.type }),
				delta: piEvent.content,
			};

		case "thinking-delta":
			return {
				...baseEvent("assistant_thinking_delta", ctx, { sourceType: piEvent.type }),
				delta: piEvent.content,
			};

		case "tool-exec-start":
			return {
				...baseEvent("tool_started", ctx, { sourceType: piEvent.type }),
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				input: piEvent.args,
			};

		case "tool-exec-update":
			return {
				...baseEvent("tool_updated", ctx, { sourceType: piEvent.type }),
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				input: piEvent.args,
				partialOutput: piEvent.partialResult,
			};

		case "tool-exec-end":
			return {
				...baseEvent("tool_finished", ctx, {
					sourceType: piEvent.type,
					...(piEvent.details !== undefined ? { details: piEvent.details } : {}),
				}),
				toolCallId: piEvent.toolCallId,
				toolName: piEvent.toolName,
				output: piEvent.result,
				isError: piEvent.isError,
			};

		case "compaction-start":
			return {
				...baseEvent("compaction_started", ctx, { sourceType: piEvent.type }),
				reason: piEvent.reason,
			};

		case "compaction-end":
			return {
				...baseEvent("compaction_finished", ctx, { sourceType: piEvent.type }),
				aborted: piEvent.aborted,
				willRetry: piEvent.willRetry,
				...(piEvent.errorMessage ? { errorMessage: piEvent.errorMessage } : {}),
			};

		case "retry-start":
			return {
				...baseEvent("retry_started", ctx, { sourceType: piEvent.type }),
				attempt: piEvent.attempt,
				maxAttempts: piEvent.maxAttempts,
				delayMs: piEvent.delayMs,
				errorMessage: piEvent.errorMessage,
			};

		case "retry-end":
			return {
				...baseEvent("retry_finished", ctx, { sourceType: piEvent.type }),
				success: piEvent.success,
				attempt: piEvent.attempt,
				...(piEvent.finalError ? { finalError: piEvent.finalError } : {}),
			};

		case "summarization-retry-scheduled":
			return {
				...baseEvent("retry_started", ctx, { sourceType: piEvent.type }),
				attempt: piEvent.attempt,
				maxAttempts: piEvent.maxAttempts,
				delayMs: piEvent.delayMs,
				errorMessage: piEvent.errorMessage,
			};

		case "summarization-retry-finished":
			return baseEvent("retry_finished", ctx, { sourceType: piEvent.type });

		case "queue-update":
			return {
				...baseEvent("backend_event", ctx),
				kind: "queue-update",
				payload: { steering: piEvent.steering, followUp: piEvent.followUp },
			};

		case "thinking-level-changed":
			return {
				...baseEvent("backend_event", ctx),
				kind: "thinking-level-changed",
				payload: { level: piEvent.level },
			};

		case "session-info-changed":
			return {
				...baseEvent("backend_event", ctx),
				kind: "session-info-changed",
				payload: { name: piEvent.name },
			};

		case "error":
			return {
				...baseEvent("error", ctx, { sourceType: piEvent.type }),
				message: piEvent.message,
				...(piEvent.code ? { code: piEvent.code } : {}),
			};

		case "extension-ui-request":
			return {
				...baseEvent("backend_event", ctx),
				kind: "extension-ui-request",
				payload: piEvent,
			};

		case "turn-start":
			return baseEvent("agent_started", ctx, { sourceType: piEvent.type });

		case "turn-end":
			return {
				...baseEvent("agent_finished", ctx, {
					sourceType: piEvent.type,
					message: piEvent.message,
					toolResults: piEvent.toolResults,
				}),
			};

		case "external-user-message":
			return {
				...baseEvent("backend_event", ctx),
				kind: "external-user-message",
				payload: {
					content: piEvent.content,
					timestamp: piEvent.timestamp,
				},
			};

		case "bash-output":
			return {
				...baseEvent("backend_event", ctx),
				kind: "bash-output",
				payload: { content: piEvent.content },
			};

		case "tool-call-start":
		case "tool-call-args-done":
		case "message-start":
		case "message-end":
		case "message-done":
			return null;
	}
	return null;
}
