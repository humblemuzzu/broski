/**
 * Where each of Pi's 24 session events and 8 message roles goes once `pi --mode rpc` writes it: read off the wire and
 * mapped or delegated, or ignored by the frame reader. A member a later Pi adds stops this file compiling.
 */

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ToolCallIds } from "../../backends/pi/ids";
import {
	compactionFinished,
	compactionStarted,
	modelChanged,
	retryFinished,
	retryScheduled,
} from "../../backends/pi/mapping/session-events";
import { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import {
	toolFinished,
	toolOutcome,
	toolOutputOf,
	toolResultOf,
	toolStartedOfExecution,
} from "../../backends/pi/mapping/tool-items";
import { type PiEvent, parseFrame } from "../../backends/pi/rpc/frames";
import type { AgentEvent } from "../../contract";
import { BASE, deepFreeze, validEvents } from "./mapping_fixtures";

type Disposition = { readonly events: AgentEvent[] } | { readonly delegated: string };

/** Whether the bridge reads each of Pi's session event types off the RPC wire, and why not when it does not. */
const ON_THE_WIRE: { readonly [T in AgentSessionEvent["type"]]: "read" | { readonly ignored: string } } = {
	agent_start: "read",
	agent_settled: "read",
	message_start: "read",
	message_update: "read",
	message_end: "read",
	tool_execution_start: "read",
	tool_execution_update: "read",
	tool_execution_end: "read",
	queue_update: "read",
	compaction_start: "read",
	compaction_end: "read",
	auto_retry_start: "read",
	auto_retry_end: "read",
	thinking_level_changed: "read",
	session_info_changed: "read",
	entry_appended: "read",
	agent_end: { ignored: "never a run boundary: only agent_settled ends a run" },
	turn_start: { ignored: "brackets every model call inside a run, not the run" },
	turn_end: { ignored: "brackets every model call inside a run, not the run" },
	summarization_retry_scheduled: { ignored: "compaction-internal retries are lost by design (contract README §15)" },
	summarization_retry_attempt_start: {
		ignored: "compaction-internal retries are lost by design (contract README §15)",
	},
	summarization_retry_finished: { ignored: "compaction-internal retries are lost by design (contract README §15)" },
	bash_execution_update: { ignored: "a user !bash command has no event in the contract" },
};

/** Where an event the bridge reads goes: mapped here, or handed to the part of the live session that owns it. */
function dispatch(event: PiEvent, tools: ToolCallIds): Disposition {
	switch (event.type) {
		case "message_start":
			return { delegated: "an assistant message starts an AssistantStream after tools.nextResponse()" };
		case "message_update": {
			const update = event.assistantMessageEvent;
			return { events: update.type === "ignored" ? [] : new AssistantStream("msg-1", tools).update(update) };
		}
		case "message_end":
			return event.message.role === "assistant"
				? { events: new AssistantStream("msg-1", tools).end(event.message) }
				: {
						delegated:
							"a user message becomes user_message once its entry id is known, a tool result finishes its call",
					};
		case "tool_execution_start":
			return { events: [toolStartedOfExecution(event, tools)] };
		case "tool_execution_update":
			toolStartedOfExecution({ ...event, args: {} }, tools);
			return { events: [toolOutputOf(event, tools)] };
		case "tool_execution_end":
			toolStartedOfExecution({ ...event, args: {} }, tools);
			return {
				events: [
					toolFinished(
						event.toolCallId,
						toolOutcome({ isError: event.isError, denied: false, aborted: false }),
						toolResultOf(event.result.content ?? [], event.isError, [], () => undefined),
						tools,
					),
				],
			};
		case "compaction_start":
			return { events: [compactionStarted(event)] };
		case "compaction_end":
			return { events: [compactionFinished(event)] };
		case "auto_retry_start":
			return { events: [retryScheduled(event, 0)] };
		case "auto_retry_end":
			return { events: [retryFinished(event)] };
		case "thinking_level_changed":
			return { events: [modelChanged(undefined, event.level)] };
		case "agent_start":
			return { delegated: "RunTracker starts the run" };
		case "agent_settled":
			return { delegated: "RunTracker settles the run with runOutcome and usageOf" };
		case "queue_update":
			return { delegated: "QueueMirror reconciles the queue" };
		case "session_info_changed":
			return { delegated: "session_updated for the catalog" };
		case "entry_appended":
			return { delegated: "EntryCursor learns where the session's entries stand" };
		case "extension_error":
			return { delegated: "a notice" };
	}
}

/** As Pi's own types have it, so the samples below are checked against Pi's union. */
const ASSISTANT: PiAssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "hi" }],
	api: "openai-completions",
	provider: "scripted",
	model: "m1",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 1,
};

const SAMPLES: { [T in AgentSessionEvent["type"]]: Extract<AgentSessionEvent, { type: T }> } = {
	agent_start: { type: "agent_start" },
	agent_end: { type: "agent_end", messages: [], willRetry: false },
	agent_settled: { type: "agent_settled", aborted: false },
	turn_start: { type: "turn_start" },
	turn_end: { type: "turn_end", message: ASSISTANT, toolResults: [] },
	message_start: { type: "message_start", message: ASSISTANT },
	message_update: {
		type: "message_update",
		message: ASSISTANT,
		assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "hi", partial: ASSISTANT },
	},
	message_end: { type: "message_end", message: ASSISTANT },
	tool_execution_start: { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a" } },
	tool_execution_update: {
		type: "tool_execution_update",
		toolCallId: "c1",
		toolName: "read",
		args: {},
		partialResult: { content: [{ type: "text", text: "so far" }] },
	},
	tool_execution_end: {
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "read",
		result: { content: [], details: undefined },
		isError: false,
	},
	queue_update: { type: "queue_update", steering: [], followUp: [] },
	compaction_start: { type: "compaction_start", reason: "threshold" },
	entry_appended: {
		type: "entry_appended",
		entry: { ...BASE, type: "message", id: "e1", message: { role: "user", content: "x", timestamp: 1 } },
	},
	session_info_changed: { type: "session_info_changed", name: "n" },
	thinking_level_changed: { type: "thinking_level_changed", level: "high" },
	compaction_end: { type: "compaction_end", reason: "threshold", result: undefined, aborted: true, willRetry: false },
	auto_retry_start: { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "e" },
	auto_retry_end: { type: "auto_retry_end", success: true, attempt: 1 },
	summarization_retry_scheduled: {
		type: "summarization_retry_scheduled",
		attempt: 1,
		maxAttempts: 3,
		delayMs: 10,
		errorMessage: "e",
	},
	summarization_retry_attempt_start: { type: "summarization_retry_attempt_start", source: "branchSummary" },
	summarization_retry_finished: { type: "summarization_retry_finished" },
	bash_execution_update: { type: "bash_execution_update", delta: "out" },
};

describe("every AgentSessionEvent", () => {
	test("the union has 24 members under 23 type values", () => {
		expect(Object.keys(SAMPLES)).toHaveLength(23);
	});

	test.each(Object.entries(SAMPLES))(
		"%s is read off the wire and mapped or delegated, or ignored with its reason",
		(type, sample) => {
			const frame = parseFrame(JSON.stringify(sample));
			const wanted = Object.entries(ON_THE_WIRE).find(([name]) => name === type)?.[1];
			if (wanted !== "read") {
				expect(frame.kind).toBe("ignored");
				expect(wanted?.ignored).toBeTruthy();
				return;
			}
			if (frame.kind !== "event") throw new Error(`${type} was not read: ${JSON.stringify(frame)}`);
			const disposition = dispatch(deepFreeze(frame.event), new ToolCallIds());
			if ("events" in disposition) validEvents(disposition.events);
			else expect(disposition.delegated).toBeTruthy();
		},
	);

	test("the second summarization_retry_attempt_start shape is ignored the same way", () => {
		const event: AgentSessionEvent = {
			type: "summarization_retry_attempt_start",
			source: "compaction",
			reason: "manual",
		};
		expect(parseFrame(JSON.stringify(event)).kind).toBe("ignored");
	});
});

describe("every message role", () => {
	const ROLES: { [R in AgentMessage["role"]]: string } = {
		system: "no item and no event: the run's loadout record",
		user: "user_message (userMessageEvent) live, user_message item stored",
		assistant: "blocks and tool calls, live (AssistantStream) and stored",
		toolResult: "tool_finished live, tool_result item stored",
		bashExecution: "a notice item stored; no live event (a user !bash command has no event in the contract)",
		custom: "a notice live (customNotice) and the same notice item stored, when displayed",
		branchSummary: "never stored as a message entry: the branch_summary entry gives a notice item",
		compactionSummary: "never stored as a message entry: the compaction entry gives a compaction item",
	};

	test("each role is decided, 8 in all", () => {
		expect(Object.keys(ROLES)).toHaveLength(8);
	});
});
