import {
	type AgentEvent,
	emptySnapshot,
	type Interaction,
	MAX_LIST_ITEMS,
	MAX_TEXT_CHARS,
	type SessionSnapshot,
	type ToolResult,
} from "../../src/contract";

/** One scripted input to the reducer: a starting state and the events applied to it, in order. */
export interface ReducerCase {
	readonly name: string;
	readonly initial: SessionSnapshot;
	readonly events: AgentEvent[];
}

const UUID = "00000000-0000-4000-8000-000000000001";
const NO_RESULT: ToolResult = { content: [], fileChanges: [] };
const run = (runId: string): AgentEvent => ({ type: "run_started", runId, trigger: "prompt" });

function ask(id: string, blocksRun: boolean): Interaction {
	return { id, runId: "r1", createdAt: 1, title: "Allow?", blocksRun, request: { kind: "confirm" } };
}

/** Every branch of `applyEvent`, `nextRun` and `sessionStatus`, beside what the fake session already covers. */
export function reducerCases(): ReducerCase[] {
	return [
		statusCase(),
		outsideRunCase(),
		blockCase(),
		toolCase(),
		retractionCase(),
		droppedItemsCase(),
		textCapCase(),
		surrogateEdgeCase(),
		settingsCase(),
		resyncCase(),
	];
}

function statusCase(): ReducerCase {
	return {
		name: "status follows runs, blocking asks and the last outcome",
		initial: emptySnapshot(),
		events: [
			{ type: "compaction_started", trigger: "manual" },
			run("r1"),
			{ type: "interaction_requested", interaction: ask("i1", false) },
			{ type: "interaction_requested", interaction: ask("i2", true) },
			{ type: "interaction_resolved", interactionId: "i2", reason: "answered" },
			{ type: "interaction_resolved", interactionId: "i1", reason: "withdrawn" },
			{ type: "retry_scheduled", attempt: 1, message: "overloaded" },
			{ type: "run_finished", runId: "r1", outcome: { kind: "suspended" } },
			{ type: "interaction_requested", interaction: ask("i3", true) },
			{ type: "interaction_resolved", interactionId: "i3", reason: "expired" },
			{ type: "compaction_finished", outcome: { kind: "failed", message: "too big" } },
			run("r2"),
			{ type: "run_finished", runId: "r2", outcome: { kind: "error", error: { code: "network", message: "down" } } },
		],
	};
}

function outsideRunCase(): ReducerCase {
	return {
		name: "content outside a run changes the live state but no run items",
		initial: emptySnapshot(),
		events: [
			{ type: "user_message", messageId: "u0", text: "hi", attachments: [] },
			{ type: "block_started", blockId: "b0", messageId: "m0", kind: "thinking" },
			{ type: "block_delta", blockId: "b0", text: "hmm" },
			{ type: "block_finished", blockId: "b0", text: "hmm." },
			{ type: "tool_started", toolCallId: "t0", name: "ls" },
			{ type: "tool_finished", toolCallId: "t0", outcome: "failed", result: { ...NO_RESULT, error: "no" } },
			{ type: "session_replaced", session: { backend: "claude-code", sessionId: "other" } },
			{ type: "messages_retracted", messageIds: ["m0"] },
		],
	};
}

function blockCase(): ReducerCase {
	return {
		name: "blocks: deltas, authoritative finish, unknown ids and subagent blocks",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "user_message", messageId: "u1", text: "go", attachments: [], clientRequestId: UUID },
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text", parentToolCallId: "t9" },
			{ type: "block_delta", blockId: "b1", text: "Hel" },
			{ type: "block_delta", blockId: "missing", text: "x" },
			{ type: "block_started", blockId: "b2", messageId: "m1", kind: "plan" },
			{ type: "block_delta", blockId: "b1", text: "lo" },
			{ type: "block_finished", blockId: "b1", text: "Hello!" },
			{ type: "block_finished", blockId: "missing", text: "never started" },
			{ type: "block_finished", blockId: "b2", text: "" },
			{ type: "notice", level: "info", text: "fyi" },
			{ type: "error", error: { code: "unknown", message: "blip" }, retryable: false },
			{ type: "extension", extension: { kind: "rate_limit", window: "five_hour", usedPercent: 50 } },
			{ type: "run_finished", runId: "r1", outcome: { kind: "completed" } },
		],
	};
}

function toolCase(): ReducerCase {
	const changes = [{ path: "a.ts", change: "modified" as const, additions: 1, deletions: 0 }];
	const child = { backend: "claude-code" as const, sessionId: "child" };
	return {
		name: "tools: every update, nesting, and the call item completed at finish",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "tool_started", toolCallId: "t1", name: "edit", title: "Edit a.ts", messageId: "m1" },
			{ type: "tool_started", toolCallId: "t2", name: "read", input: { path: "a.ts" }, parentToolCallId: "t1" },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "input", input: { path: "a.ts", n: [1, 2.5] } } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "one " } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "two" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_replaced", text: "three" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "progress", message: "50%" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "file_changes", changes } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "file_changes", changes: [] } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "child_session", session: child } },
			{ type: "tool_updated", toolCallId: "missing", update: { kind: "progress", message: "lost" } },
			{ type: "tool_finished", toolCallId: "t2", outcome: "denied", result: NO_RESULT },
			{
				type: "tool_finished",
				toolCallId: "t1",
				outcome: "completed",
				result: { content: [{ kind: "text", text: "ok" }], fileChanges: changes, exitCode: 0 },
			},
			{ type: "tool_finished", toolCallId: "never-started", outcome: "aborted", result: NO_RESULT },
			{ type: "run_finished", runId: "r1", outcome: { kind: "limit", limit: "max_turns" } },
		],
	};
}

function retractionCase(): ReducerCase {
	return {
		name: "a retraction removes the messages' blocks, calls and results, open or finished",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "block_started", blockId: "b0", messageId: "m1", kind: "text" },
			{ type: "block_finished", blockId: "b0", text: "gone" },
			{ type: "tool_started", toolCallId: "t0", name: "ls", messageId: "m1" },
			{ type: "tool_finished", toolCallId: "t0", outcome: "completed", result: NO_RESULT },
			{ type: "tool_started", toolCallId: "t3", name: "pwd" },
			{ type: "tool_finished", toolCallId: "t3", outcome: "completed", result: NO_RESULT },
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "tool_started", toolCallId: "t1", name: "cat", messageId: "m1" },
			{ type: "block_started", blockId: "b2", messageId: "m2", kind: "text" },
			{ type: "messages_retracted", messageIds: ["m1", "m9"] },
			{ type: "block_finished", blockId: "b2", text: "kept" },
			{ type: "run_finished", runId: "r1", outcome: { kind: "deferred" } },
		],
	};
}

function droppedItemsCase(): ReducerCase {
	const messages: AgentEvent[] = Array.from({ length: MAX_LIST_ITEMS + 3 }, (_, index) => ({
		type: "user_message",
		messageId: `u${index}`,
		text: "",
		attachments: [],
	}));
	return {
		name: "a long run drops its oldest items, counts them, and a replacement starts afresh",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "tool_started", toolCallId: "t1", name: "sleep", messageId: "m1" },
			...messages,
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "input", input: { s: 1 } } },
			{ type: "tool_finished", toolCallId: "t1", outcome: "completed", result: NO_RESULT },
			{ type: "messages_retracted", messageIds: ["u1002"] },
			{ type: "session_replaced", session: { backend: "claude-code", sessionId: "next" } },
			{ type: "user_message", messageId: "u-next", text: "again", attachments: [] },
		],
	};
}

/** The cap keeps the newest characters and never starts inside a surrogate pair. */
function textCapCase(): ReducerCase {
	const pairs = "😀".repeat(MAX_TEXT_CHARS / 2);
	return {
		name: "open text and running output keep their newest characters within the cap",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "block_delta", blockId: "b1", text: "a".repeat(MAX_TEXT_CHARS - 2) },
			{ type: "block_delta", blockId: "b1", text: "bc" },
			{ type: "block_delta", blockId: "b1", text: "d" },
			{ type: "block_finished", blockId: "b1", text: "short" },
			{ type: "block_started", blockId: "b2", messageId: "m1", kind: "thinking" },
			{ type: "block_delta", blockId: "b2", text: pairs },
			{ type: "block_delta", blockId: "b2", text: "z" },
			{ type: "block_finished", blockId: "b2", text: "done" },
			{ type: "tool_started", toolCallId: "t1", name: "cat" },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: pairs } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "😀z" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_replaced", text: "a".repeat(MAX_TEXT_CHARS) } },
			{ type: "tool_finished", toolCallId: "t1", outcome: "completed", result: NO_RESULT },
			{ type: "run_finished", runId: "r1", outcome: { kind: "aborted" } },
		],
	};
}

/**
 * The cut falls on each edge of the low surrogates: U+DC00 and U+DFFF (the low halves of U+10000 and
 * U+10FFFF) are dropped; U+DBFF (a high half) and U+E000 (past the surrogates) are kept.
 */
function surrogateEdgeCase(): ReducerCase {
	const cutOn = (id: string, ...texts: string[]): AgentEvent[] => [
		{ type: "block_started", blockId: id, messageId: "m1", kind: "text" },
		...texts.map((text): AgentEvent => ({ type: "block_delta", blockId: id, text })),
		{ type: "block_delta", blockId: id, text: "z" },
		{ type: "block_finished", blockId: id, text: "done" },
	];
	const last = "\u{10ffff}";
	return {
		name: "the cut drops a low surrogate at either edge of the range, and keeps what is outside it",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			...cutOn("low-first", "\u{10000}".repeat(MAX_TEXT_CHARS / 2)),
			...cutOn("low-last", last.repeat(MAX_TEXT_CHARS / 2)),
			...cutOn("high-last", `x${last.repeat(MAX_TEXT_CHARS / 2 - 1)}`, last),
			...cutOn("past", "\ue000".repeat(MAX_TEXT_CHARS)),
			{ type: "run_finished", runId: "r1", outcome: { kind: "completed" } },
		],
	};
}

function settingsCase(): ReducerCase {
	return {
		name: "settings: model, thinking, modes, queue, usage and plan are replaced",
		initial: { ...emptySnapshot(), modelId: "m0", thinking: "low", modes: [{ axis: "a", value: "1" }] },
		events: [
			{ type: "model_changed", modelId: "m1", thinking: "high" },
			{ type: "model_changed", modelId: "m2" },
			{ type: "model_changed", thinking: "max" },
			{ type: "model_changed" },
			{ type: "mode_changed", axis: "b", value: "x" },
			{ type: "mode_changed", axis: "a", value: "2" },
			{ type: "queue_changed", items: [{ id: "q1", delivery: "queue", preview: "later", clientRequestId: UUID }] },
			{ type: "queue_changed", items: [] },
			{ type: "usage_updated", usage: { inputTokens: 5, costUsd: 0.25, contextWindow: 1000 } },
			{ type: "usage_updated", usage: {} },
			{ type: "plan_updated", plan: { items: [{ text: "Do", status: "cancelled" }], explanation: "why" } },
			{ type: "retry_scheduled", attempt: 2, maxAttempts: 3, retryAt: 500, message: "busy" },
			{ type: "retry_finished", succeeded: false },
		],
	};
}

function resyncCase(): ReducerCase {
	const replacement: SessionSnapshot = {
		...emptySnapshot(),
		run: { runId: "r9", trigger: "external", startedAt: 5, items: [], droppedItems: 4 },
		blocks: [{ blockId: "b9", messageId: "m9", kind: "text", text: "partial" }],
		interactions: [ask("i9", true)],
	};
	return {
		name: "resynced replaces the state, and later events apply on top of it",
		initial: emptySnapshot(),
		events: [
			run("r1"),
			{ type: "user_message", messageId: "u1", text: "first", attachments: [] },
			{ type: "resynced", snapshot: replacement },
			{ type: "block_delta", blockId: "b9", text: " text" },
			{ type: "block_finished", blockId: "b9", text: "partial text" },
			{ type: "resynced", snapshot: emptySnapshot() },
		],
	};
}
