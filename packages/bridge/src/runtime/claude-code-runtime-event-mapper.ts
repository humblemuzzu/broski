import type { ClaudeCodeStreamMessage } from "../types";
import type { BroskiBackendData, BroskiRuntimeEvent } from "../types/runtime";

type ClaudeCodeRuntimeEventContext = {
	backend: "claude-code";
	sessionId?: string;
	cwd?: string;
};

const baseEvent = <TType extends BroskiRuntimeEvent["type"]>(
	type: TType,
	ctx: ClaudeCodeRuntimeEventContext,
	backendData?: BroskiBackendData,
) => ({
	type,
	backend: ctx.backend,
	timestampMs: Date.now(),
	...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
	...(ctx.cwd ? { cwd: ctx.cwd } : {}),
	...(backendData ? { backendData } : {}),
});

export function mapClaudeCodeStreamToRuntimeEvent(
	streamMessage: ClaudeCodeStreamMessage,
	ctx: ClaudeCodeRuntimeEventContext,
): BroskiRuntimeEvent | null {
	const sessionId =
		streamMessage.type === "session-created"
			? streamMessage.sessionId
			: streamMessage.type === "permission-request" || streamMessage.type === "elicitation-request"
				? streamMessage.sessionId
				: ctx.sessionId;

	const eventContext = {
		...ctx,
		...(sessionId ? { sessionId } : {}),
	};

	switch (streamMessage.type) {
		case "session-created":
			return {
				...baseEvent("agent_started", eventContext, {
					sourceType: streamMessage.type,
					agent: streamMessage.agent,
					...(streamMessage.model ? { model: streamMessage.model } : {}),
				}),
			};

		case "assistant-message-delta":
			return {
				...baseEvent("assistant_text_delta", eventContext, {
					sourceType: streamMessage.type,
				}),
				...(streamMessage.messageId ? { messageId: streamMessage.messageId } : {}),
				delta: streamMessage.content,
			};

		case "thinking-delta":
			return {
				...baseEvent("assistant_thinking_delta", eventContext, {
					sourceType: streamMessage.type,
					...(streamMessage.partId ? { partId: streamMessage.partId } : {}),
				}),
				...(streamMessage.messageId ? { messageId: streamMessage.messageId } : {}),
				delta: streamMessage.content,
			};

		case "tool-call":
			if (streamMessage.status === "completed" || streamMessage.status === "failed") {
				return {
					...baseEvent("tool_finished", eventContext, {
						sourceType: streamMessage.type,
						status: streamMessage.status,
						...(streamMessage.parentToolUseId ? { parentToolUseId: streamMessage.parentToolUseId } : {}),
					}),
					...(streamMessage.messageId ? { messageId: streamMessage.messageId } : {}),
					...(streamMessage.toolUseId ? { toolCallId: streamMessage.toolUseId } : {}),
					toolName: streamMessage.tool,
					input: streamMessage.input,
					isError: streamMessage.status === "failed",
				};
			}

			return {
				...baseEvent("tool_started", eventContext, {
					sourceType: streamMessage.type,
					status: streamMessage.status,
					...(streamMessage.parentToolUseId ? { parentToolUseId: streamMessage.parentToolUseId } : {}),
				}),
				...(streamMessage.messageId ? { messageId: streamMessage.messageId } : {}),
				...(streamMessage.toolUseId ? { toolCallId: streamMessage.toolUseId } : {}),
				toolName: streamMessage.tool,
				input: streamMessage.input,
			};

		case "tool-result":
			return {
				...baseEvent("tool_finished", eventContext, {
					sourceType: streamMessage.type,
					...(streamMessage.toolUseResult !== undefined ? { toolUseResult: streamMessage.toolUseResult } : {}),
					...(streamMessage.parentToolUseId ? { parentToolUseId: streamMessage.parentToolUseId } : {}),
				}),
				...(streamMessage.messageId ? { messageId: streamMessage.messageId } : {}),
				...(streamMessage.toolUseId ? { toolCallId: streamMessage.toolUseId } : {}),
				output: streamMessage.result,
			};

		case "permission-request":
			return {
				...baseEvent("permission_requested", eventContext, {
					sourceType: streamMessage.type,
					...(streamMessage.agentId ? { agentId: streamMessage.agentId } : {}),
				}),
				...(streamMessage.toolUseId ? { toolCallId: streamMessage.toolUseId } : {}),
				request: {
					requestId: streamMessage.toolUseId,
					kind: streamMessage.tool,
					// SDK 0.2.87: Prefer SDK-provided title, fall back to description, then generic
					title: streamMessage.title || streamMessage.description || `Allow ${streamMessage.tool}?`,
					message: streamMessage.decisionReason,
					metadata: {
						tool: streamMessage.tool,
						input: streamMessage.input,
						...(streamMessage.blockedPath ? { blockedPath: streamMessage.blockedPath } : {}),
						...(streamMessage.hasSuggestions !== undefined ? { hasSuggestions: streamMessage.hasSuggestions } : {}),
						// SDK 0.2.87: Forward suggestions for "Always Allow" rule persistence
						...(Array.isArray(streamMessage.suggestions) ? { ccSuggestions: streamMessage.suggestions } : {}),
						// SDK 0.2.87: Human-readable fields
						...(streamMessage.displayName ? { ccDisplayName: streamMessage.displayName } : {}),
						...(streamMessage.title ? { ccTitle: streamMessage.title } : {}),
						...(streamMessage.description ? { ccDescription: streamMessage.description } : {}),
					},
				},
			};

		case "result-complete":
			return {
				...baseEvent("agent_finished", eventContext, {
					sourceType: streamMessage.type,
					...(streamMessage.subtype ? { subtype: streamMessage.subtype } : {}),
					...(streamMessage.isError !== undefined ? { isError: streamMessage.isError } : {}),
					...(streamMessage.errors ? { errors: streamMessage.errors } : {}),
					...(streamMessage.permissionDenials ? { permissionDenials: streamMessage.permissionDenials } : {}),
					...(streamMessage.fastModeState ? { fastModeState: streamMessage.fastModeState } : {}),
				}),
				...(streamMessage.stopReason ? { stopReason: streamMessage.stopReason } : {}),
			};

		case "assistant-error":
			return {
				...baseEvent("error", eventContext, {
					sourceType: streamMessage.type,
				}),
				message: streamMessage.errorType,
				code: "assistant_error",
			};

		case "error":
			return {
				...baseEvent("error", eventContext, {
					sourceType: streamMessage.type,
				}),
				message: streamMessage.message,
				...(streamMessage.code ? { code: streamMessage.code } : {}),
			};

		case "elicitation-request":
		case "elicitation-complete":
		case "checkpoint-created":
			return {
				...baseEvent("backend_event", eventContext),
				kind: streamMessage.type,
				payload: streamMessage,
			};

		case "hook-started":
		case "hook-progress":
		case "hook-response":
			return {
				...baseEvent("backend_event", eventContext),
				kind: streamMessage.type,
				payload: streamMessage,
			};

		case "compact-boundary":
			return {
				...baseEvent("compaction_finished", eventContext),
			};

		case "status-update":
			if (streamMessage.status === "compacting") {
				return { ...baseEvent("compaction_started", eventContext), reason: "context-limit" };
			}
			return null;

		case "session-init":
			return {
				...baseEvent("backend_event", eventContext, {
					sourceType: streamMessage.type,
				}),
				kind: "session-init",
				payload: streamMessage,
			};

		case "assistant-message":
			return null; // no-op — both old path and new path ignore this

		case "subagent-invocation":
			return {
				...baseEvent("backend_event", eventContext, {
					sourceType: streamMessage.type,
				}),
				kind: "subagent-invocation",
				payload: streamMessage,
			};

		case "token-usage":
			return {
				...baseEvent("backend_event", eventContext, {
					sourceType: streamMessage.type,
				}),
				kind: "token-usage",
				payload: streamMessage,
			};

		case "structured-output":
			return {
				...baseEvent("backend_event", eventContext, {
					sourceType: streamMessage.type,
				}),
				kind: "structured-output",
				payload: streamMessage,
			};

		case "local-command-output":
		case "task-started":
		case "task-progress":
		case "task-notification":
		case "tool-use-summary":
		case "files-persisted":
		case "rate-limit-info":
		case "prompt-suggestion":
		case "auth-status":
		case "session-state-changed":
		case "api-retry":
			return {
				...baseEvent("backend_event", eventContext),
				kind: streamMessage.type,
				payload: streamMessage,
			};
	}
}
