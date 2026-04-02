import type { CodexStreamMessage } from "../types";
import type { BroskiBackendData, BroskiRuntimeEvent } from "../types/runtime";
import { extractToolCallId } from "./shared";
import { enrichRuntimeEvent } from "./stream-contract";

type CodexRuntimeEventContext = {
	backend: "codex";
	threadId?: string;
	cwd?: string;
};

const baseEvent = <TType extends BroskiRuntimeEvent["type"]>(
	type: TType,
	ctx: CodexRuntimeEventContext,
	backendData?: BroskiBackendData,
) =>
	enrichRuntimeEvent({
		type,
		backend: ctx.backend,
		timestampMs: Date.now(),
		...(ctx.threadId ? { sessionId: ctx.threadId } : {}),
		...(ctx.cwd ? { cwd: ctx.cwd } : {}),
		...(backendData ? { backendData } : {}),
	} as Extract<BroskiRuntimeEvent, { type: TType }>);

function pickToolName(item: any): string | undefined {
	if (!item || typeof item !== "object") return undefined;
	const itemType = typeof item.type === "string" ? item.type : "";
	if (typeof item.tool === "string" && item.tool.length > 0) return item.tool;
	if (typeof item.name === "string" && item.name.length > 0) return item.name;
	switch (itemType) {
		case "commandExecution":
			return "Bash";
		case "fileChange":
			return "ApplyPatch";
		case "mcpToolCall":
			return `${String(item.server ?? "")}.${String(item.tool ?? "")}`.replace(/^\./, "");
		case "webSearch":
			return "WebSearch";
		case "review":
			return "Review";
		case "dynamicToolCall":
			return typeof item.tool === "string" ? item.tool : "DynamicTool";
		default:
			return itemType || undefined;
	}
}

function isCodexToolItem(item: any): boolean {
	const itemType = typeof item?.type === "string" ? item.type : "";
	return (
		itemType === "commandExecution" ||
		itemType === "fileChange" ||
		itemType === "mcpToolCall" ||
		itemType === "webSearch" ||
		itemType === "dynamicToolCall" ||
		itemType === "review" ||
		itemType === "imageGeneration"
	);
}

function parseMaybeJson(input: unknown): unknown {
	if (typeof input !== "string") return input;
	const trimmed = input.trim();
	if (!trimmed) return input;
	try {
		return JSON.parse(trimmed);
	} catch {
		return input;
	}
}

export function mapCodexStreamToRuntimeEvent(
	streamMessage: CodexStreamMessage,
	ctx: CodexRuntimeEventContext,
): BroskiRuntimeEvent | null {
	switch (streamMessage.type) {
		case "error":
			return {
				...baseEvent("error", ctx, {
					sourceType: streamMessage.type,
					...(streamMessage.details !== undefined ? { details: streamMessage.details } : {}),
					...(streamMessage.modelCapModel ? { modelCapModel: streamMessage.modelCapModel } : {}),
					...(streamMessage.modelCapRetrySeconds !== undefined
						? { modelCapRetrySeconds: streamMessage.modelCapRetrySeconds }
						: {}),
				}),
				message: streamMessage.message,
				...(streamMessage.code ? { code: streamMessage.code } : {}),
			};

		case "request": {
			if (streamMessage.method === "item/tool/requestUserInput") {
				const params = streamMessage.params ?? {};
				return {
					...baseEvent("user_input_requested", ctx, {
						sourceType: streamMessage.type,
						method: streamMessage.method,
					}),
					request: {
						requestId: streamMessage.requestId,
						kind: "tool_input",
						title: typeof params.title === "string" ? params.title : "Input required",
						prompt:
							typeof params.prompt === "string"
								? params.prompt
								: typeof params.message === "string"
									? params.message
									: undefined,
						placeholder: typeof params.placeholder === "string" ? params.placeholder : undefined,
						options: Array.isArray(params.options) ? params.options.map((value: unknown) => String(value)) : undefined,
						metadata: params,
					},
				};
			}

			if (streamMessage.method === "mcpServer/elicitation/request") {
				const params = streamMessage.params ?? {};
				return {
					...baseEvent("user_input_requested", ctx, {
						sourceType: streamMessage.type,
						method: streamMessage.method,
					}),
					request: {
						requestId: streamMessage.requestId,
						kind: "mcp_elicitation",
						title: typeof params.serverName === "string" ? params.serverName : "MCP Server",
						prompt: typeof params.message === "string" ? params.message : undefined,
						options: undefined,
						metadata: params,
					},
				};
			}

			if (streamMessage.method.includes("requestApproval")) {
				const params = streamMessage.params ?? {};
				return {
					...baseEvent("permission_requested", ctx, {
						sourceType: streamMessage.type,
						method: streamMessage.method,
					}),
					...(typeof params.itemId === "string" ? { toolCallId: params.itemId } : {}),
					request: {
						requestId: streamMessage.requestId,
						kind: streamMessage.method,
						title: typeof params.reason === "string" && params.reason.length > 0 ? params.reason : "Approval required",
						message:
							typeof params.command === "string"
								? params.command
								: typeof params.skillName === "string"
									? params.skillName
									: undefined,
						metadata: params,
					},
				};
			}

			return null;
		}

		case "notification": {
			const params = streamMessage.params ?? {};

			switch (streamMessage.method) {
				case "turn/started":
					return {
						...baseEvent("agent_started", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							turnId: params.turnId ?? params.turn?.id,
						}),
					};

				case "turn/completed":
					return {
						...baseEvent("agent_finished", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							turnId: params.turnId ?? params.turn?.id,
							status: params.turn?.status,
						}),
						...(typeof params.turn?.status === "string" ? { stopReason: params.turn.status } : {}),
					};

				case "turn/failed":
					return {
						...baseEvent("agent_finished", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							turnId: params.turnId ?? params.turn?.id,
							status: "failed",
						}),
						stopReason: "failed",
					};

				case "thread/compacted":
					return {
						...baseEvent("compaction_finished", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							params,
						}),
					};

				case "item/started":
				case "item/completed": {
					const item = params.item;
					const itemType = typeof item?.type === "string" ? item.type : "";

					// Special item types → backend_event (not tool cards)
					if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode" || itemType === "contextCompaction") {
						return {
							...baseEvent("backend_event", ctx, {
								sourceType: streamMessage.type,
								method: streamMessage.method,
								itemType,
							}),
							kind: itemType,
							payload: params,
						};
					}

					if (!isCodexToolItem(item)) return null;

					const isToolStart = streamMessage.method === "item/started";
					const toolCallId = extractToolCallId(item);
					const toolName = pickToolName(item);
					const input = item?.input ??
						item?.arguments ?? {
							...(item?.command ? { command: item.command } : {}),
							...(item?.cwd ? { cwd: item.cwd } : {}),
							...(item?.changes ? { changes: item.changes } : {}),
							...(item?.query ? { query: item.query } : {}),
						};

					if (isToolStart) {
						return {
							...baseEvent("tool_started", ctx, {
								sourceType: streamMessage.type,
								method: streamMessage.method,
								itemType: item.type,
								status: item.status,
							}),
							...(toolCallId ? { toolCallId } : {}),
							...(toolName ? { toolName } : {}),
							input,
						};
					}

					const output = item?.result ?? item?.output ?? item?.aggregatedOutput ?? item?.error;
					return {
						...baseEvent("tool_finished", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemType: item.type,
							status: item.status,
						}),
						...(toolCallId ? { toolCallId } : {}),
						...(toolName ? { toolName } : {}),
						input,
						output,
						isError: item?.status === "failed" || item?.status === "declined",
					};
				}

				case "item/commandExecution/outputDelta": {
					const itemId =
						typeof params.itemId === "string"
							? params.itemId
							: typeof params.item_id === "string"
								? params.item_id
								: undefined;
					if (!itemId || typeof params.delta !== "string" || !params.delta) {
						return null;
					}

					return {
						...baseEvent("tool_updated", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						toolCallId: itemId,
						toolName: "Bash",
						partialOutput: params.delta,
					};
				}

				case "rawResponseItem/completed": {
					const item = params.item;
					const itemType = typeof item?.type === "string" ? item.type : "";
					if (
						itemType !== "function_call" &&
						itemType !== "function_call_output" &&
						itemType !== "custom_tool_call" &&
						itemType !== "custom_tool_call_output"
					) {
						return null;
					}

					const toolCallId = extractToolCallId(item);
					if (!toolCallId) return null;

					if (itemType === "function_call" || itemType === "custom_tool_call") {
						return {
							...baseEvent("tool_started", ctx, {
								sourceType: streamMessage.type,
								method: streamMessage.method,
								itemType,
							}),
							toolCallId,
							...(pickToolName(item) ? { toolName: pickToolName(item) } : {}),
							input: parseMaybeJson(item?.arguments ?? item?.input),
						};
					}

					return {
						...baseEvent("tool_finished", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemType,
						}),
						toolCallId,
						output: item?.output,
					};
				}

				case "thread/started":
				case "thread/tokenUsage/updated":
				case "turn/plan/updated":
				case "turn/diff/updated":
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: streamMessage.method,
						payload: params,
					};

				// BUG-3: model/rerouted — user needs to know model was changed
				case "model/rerouted": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: "model/rerouted",
						payload: params,
					};
				}

				// BUG-6: serverRequest/resolved — dismiss stale approval prompts
				case "serverRequest/resolved": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: "serverRequest/resolved",
						payload: params,
					};
				}

				// Hook lifecycle events
				case "hook/started":
				case "hook/completed": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: streamMessage.method,
						payload: params,
					};
				}

				// Streaming file change diffs (mirrors item/commandExecution/outputDelta)
				case "item/fileChange/outputDelta": {
					const itemId =
						typeof params.itemId === "string"
							? params.itemId
							: typeof params.item_id === "string"
								? params.item_id
								: undefined;
					if (!itemId) return null;

					const deltaBase64 = params.deltaBase64 ?? params.delta_base64;
					const delta =
						typeof deltaBase64 === "string"
							? Buffer.from(deltaBase64, "base64").toString("utf8")
							: typeof params.delta === "string"
								? params.delta
								: undefined;
					if (!delta) return null;

					return {
						...baseEvent("tool_updated", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						toolCallId: itemId,
						toolName: "ApplyPatch",
						partialOutput: delta,
					};
				}

				// MCP tool call progress
				case "item/mcpToolCall/progress": {
					const mcpItemId =
						typeof params.itemId === "string"
							? params.itemId
							: typeof params.item_id === "string"
								? params.item_id
								: undefined;
					if (!mcpItemId) return null;

					const progress =
						typeof params.progress === "string"
							? params.progress
							: typeof params.message === "string"
								? params.message
								: undefined;

					return {
						...baseEvent("tool_updated", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						toolCallId: mcpItemId,
						toolName: typeof params.server === "string" ? params.server : "MCP",
						partialOutput: progress ?? "",
					};
				}

				// Assistant text streaming — the main agent reply
				// Protocol: AgentMessageDeltaNotification { delta, itemId, threadId, turnId }
				case "item/agentMessage/delta": {
					const delta = typeof params.delta === "string" ? params.delta : "";
					if (!delta) return null;
					return {
						...baseEvent("assistant_text_delta", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemId: params.itemId,
							turnId: params.turnId,
						}),
						delta,
					};
				}

				// Reasoning summary text — readable thinking/reasoning summaries
				// Protocol: ReasoningSummaryTextDeltaNotification { delta, itemId, summaryIndex, threadId, turnId }
				case "item/reasoning/summaryTextDelta": {
					const delta = typeof params.delta === "string" ? params.delta : "";
					if (!delta) return null;
					return {
						...baseEvent("assistant_thinking_delta", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemId: params.itemId,
							summaryIndex: params.summaryIndex,
							turnId: params.turnId,
						}),
						delta,
					};
				}

				// Raw reasoning text — only for models that expose raw thinking (e.g. open-source)
				// Protocol: ReasoningTextDeltaNotification { delta, contentIndex, itemId, threadId, turnId }
				case "item/reasoning/textDelta": {
					const delta = typeof params.delta === "string" ? params.delta : "";
					if (!delta) return null;
					return {
						...baseEvent("assistant_thinking_delta", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemId: params.itemId,
							contentIndex: params.contentIndex,
							turnId: params.turnId,
						}),
						delta,
					};
				}

				// Reasoning summary part boundary — marks new section, no delta content
				// Protocol: ReasoningSummaryPartAddedNotification { itemId, summaryIndex, threadId, turnId }
				case "item/reasoning/summaryPartAdded": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
							itemId: params.itemId,
							summaryIndex: params.summaryIndex,
							turnId: params.turnId,
						}),
						kind: "reasoning/summaryPartAdded",
						payload: params,
					};
				}

				// Streaming plan text (incremental delta as plan text is written)
				case "item/plan/delta": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: "item/plan/delta",
						payload: params,
					};
				}

				// Standalone command exec output streaming (PTY mode)
				case "command/exec/outputDelta": {
					const processId = typeof params.processId === "string" ? params.processId : undefined;
					if (!processId) return null;

					const outputDelta =
						typeof params.deltaBase64 === "string" ? Buffer.from(params.deltaBase64, "base64").toString("utf8") : "";

					return {
						...baseEvent("tool_updated", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						toolCallId: processId,
						toolName: "Bash",
						partialOutput: outputDelta,
					};
				}

				// Terminal interaction — agent needs stdin from user during command execution
				case "item/commandExecution/terminalInteraction": {
					const itemId =
						typeof params.itemId === "string"
							? params.itemId
							: typeof params.item_id === "string"
								? params.item_id
								: undefined;
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: "terminal_interaction",
						payload: {
							...params,
							...(itemId ? { itemId } : {}),
						},
					};
				}

				// Image generation items
				case "item/imageGeneration/started":
				case "item/imageGeneration/completed": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: streamMessage.method,
						payload: params,
					};
				}

				case "item/autoApprovalReview/started":
				case "item/autoApprovalReview/completed": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: streamMessage.method,
						payload: params,
					};
				}

				case "thread/realtime/started":
				case "thread/realtime/itemAdded":
				case "thread/realtime/transcriptUpdated":
				case "thread/realtime/outputAudio/delta":
				case "thread/realtime/error":
				case "thread/realtime/closed": {
					return {
						...baseEvent("backend_event", ctx, {
							sourceType: streamMessage.type,
							method: streamMessage.method,
						}),
						kind: streamMessage.method,
						payload: params,
					};
				}

				default:
					console.log(`[Codex runtime mapper] Unmapped notification: ${streamMessage.method}`);
					return null;
			}
		}

		case "collab_spawn_begin":
		case "collab_spawn_end":
		case "collab_interaction_begin":
		case "collab_interaction_end":
		case "collab_waiting_begin":
		case "collab_waiting_end":
		case "collab_close_begin":
		case "collab_close_end":
		case "collab_resume_begin":
		case "collab_resume_end":
			return {
				...baseEvent("backend_event", ctx),
				kind: streamMessage.type,
				payload: streamMessage.data ?? streamMessage,
			};
	}
	return null;
}
