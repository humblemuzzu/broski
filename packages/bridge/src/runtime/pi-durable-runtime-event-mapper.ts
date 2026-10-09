import type { AgentEvent } from "@earendil-works/pi-durable";
import type { BroskiBackendEvent, BroskiRuntimeEvent } from "../types/runtime";
import {
	PI_DURABLE_BACKEND,
	type PiDurableReadContext,
	piDurableRuntimeState,
	piDurableUsagePayload,
} from "./pi-durable-runtime-read-models";
import { enrichRuntimeEvent } from "./stream-contract";

export type PiDurableMapContext = PiDurableReadContext & {
	timestampMs?: number;
	replayed?: boolean;
};

function envelope<TType extends BroskiRuntimeEvent["type"]>(
	type: TType,
	context: PiDurableMapContext,
	extra?: Record<string, unknown>,
): Extract<BroskiRuntimeEvent, { type: TType }> {
	return enrichRuntimeEvent(
		{
			type,
			backend: PI_DURABLE_BACKEND,
			timestampMs: context.timestampMs ?? Date.now(),
			...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
			...(context.cwd !== undefined ? { cwd: context.cwd } : {}),
			...(context.replayed === true ? { replayed: true } : {}),
			...extra,
		} as Extract<BroskiRuntimeEvent, { type: TType }>,
		{ backend: PI_DURABLE_BACKEND, isReplay: context.replayed === true },
	);
}

function backendEvent(
	kind: string,
	payload: unknown,
	context: PiDurableMapContext,
	extra?: Record<string, unknown>,
): BroskiBackendEvent {
	return envelope("backend_event", context, { kind, payload, ...extra });
}

function toolResultOf(event: Extract<AgentEvent, { type: "tool_execution_end" }>): {
	output: unknown;
	isError?: boolean;
} {
	const message = event.entry?.model?.[0];
	if (message === undefined) return { output: undefined };
	return { output: message, ...(message.role === "toolResult" ? { isError: message.isError } : {}) };
}

/**
 * One durable agent event to the Broski runtime events it corresponds to. Pure: no state, no clock reads beyond
 * `context.timestampMs`. `message_update` maps to nothing here: `PiDurableEventBridge` owns every message text
 * delta, because `message_update.changes` is message-relative, not a flat delta stream.
 */
export function mapDurableEventToBroski(event: AgentEvent, context: PiDurableMapContext = {}): BroskiRuntimeEvent[] {
	switch (event.type) {
		case "snapshot":
			return [envelope("session_state_changed", context, { state: piDurableRuntimeState(event, context) })];

		case "run_start":
			return [envelope("agent_started", context, { backendData: { sourceType: "run_start", inputs: event.inputs } })];

		case "run_end":
			return [envelope("agent_finished", context, { backendData: { sourceType: "run_end", inputs: event.inputs } })];

		case "turn_start":
			return [envelope("agent_started", context, { backendData: { sourceType: "turn_start" } })];

		case "turn_end":
			return [envelope("agent_finished", context, { backendData: { sourceType: "turn_end" } })];

		case "message_start":
		case "message_update":
		case "message_end":
			return [];

		case "tool_execution_start":
			return [
				envelope("tool_started", context, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.args,
				}),
			];

		case "tool_execution_update":
			return [
				envelope("tool_updated", context, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					partialOutput: event.output,
					...(event.details !== undefined || event.diagnostics !== undefined
						? {
								backendData: {
									sourceType: "tool_execution_update",
									...(event.details !== undefined ? { details: event.details } : {}),
									...(event.diagnostics !== undefined ? { diagnostics: event.diagnostics } : {}),
								},
							}
						: {}),
				}),
			];

		case "tool_execution_end": {
			const result = toolResultOf(event);
			return [
				envelope("tool_finished", context, {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					output: result.output,
					...(result.isError !== undefined ? { isError: result.isError } : {}),
					backendData: {
						sourceType: "tool_execution_end",
						entryId: event.entry?.id,
						entryMissing: event.entry === undefined,
					},
				}),
			];
		}

		case "inbox_update":
			return [backendEvent("queue-update", { items: event.items }, context)];

		case "submission":
			return [backendEvent("submission", event.record, context)];

		case "auto_retry_start":
			return [
				envelope("retry_started", context, {
					attempt: event.attempt,
					delayMs: Math.max(0, event.at - (context.timestampMs ?? Date.now())),
					errorMessage: event.errorMessage,
				}),
			];

		case "auto_retry_end":
			return [envelope("retry_finished", context, { attempt: event.attempt })];

		case "deferred_poll":
			return [backendEvent("deferred_poll", { pollAt: event.pollAt }, context)];

		case "entry_appended":
			return [
				backendEvent(
					"entry_appended",
					{ id: event.entry.id, kind: event.entry.kind, head: event.entry.head },
					context,
					{ messageId: String(event.entry.id) },
				),
			];

		case "agent_changed":
			return [backendEvent("agent_changed", event.agent, context)];

		case "usage_changed":
			return [backendEvent("usage_changed", piDurableUsagePayload(event.usage, context), context)];

		case "task_failed":
			return [
				envelope("error", context, {
					message: event.message,
					code: "task_failed",
					details: { taskId: event.taskId, kind: event.kind },
				}),
			];

		case "compaction_start":
			return [
				envelope("compaction_started", context, {
					reason: event.reason,
					backendData: { taskId: event.taskId, blocking: event.blocking },
				}),
			];

		case "compaction_end":
			return [
				envelope("compaction_finished", context, {
					backendData: { taskId: event.taskId, reason: event.reason },
				}),
			];

		default:
			return [];
	}
}
