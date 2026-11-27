/**
 * A live session's turns and asks, fed through the bridge's own JSON-RPC layer with the records ACP's documentation
 * shows (agentclientprotocol.com/protocol/v1/draft: prompt-turn, tool-calls, cancellation; the v1 schema's
 * `CancelRequestNotification`), as written there. None is a record agy wrote: what agy does with them is checked on the
 * real `agy`. Every stream is held to the contract's stream rules (`contract/testing/stream-rules.ts`).
 */

import { describe, expect, test } from "bun:test";
import { LiveState } from "../../adapter-kit/live-state";
import type { PromptResult as PromptAnswer } from "../../backends/antigravity/acp/frames";
import { JsonRpc, type RpcResult } from "../../backends/antigravity/acp/rpc";
import { AgyAsks, UNSHOWN_QUESTION } from "../../backends/antigravity/live/asks";
import { PhoneImages } from "../../backends/antigravity/live/images";
import { Turns } from "../../backends/antigravity/live/turns";
import { ANTIGRAVITY_TRAITS } from "../../backends/antigravity/traits";
import { emptySnapshot, type Interaction, type SinkRecord } from "../../contract";
import { streamViolations } from "../../contract/testing/stream-rules";

const SESSION = "sess_abc123def456";

/** protocol/v1/draft/tool-calls, "Requesting permission" */
const PERMISSION = {
	jsonrpc: "2.0",
	id: 5,
	method: "session/request_permission",
	params: {
		sessionId: SESSION,
		toolCall: { toolCallId: "call_001" },
		options: [
			{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
			{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
		],
	},
};

function update(body: object) {
	return { jsonrpc: "2.0", method: "session/update", params: { sessionId: SESSION, update: body } };
}

/** protocol/v1/draft/prompt-turn, "3. Agent reports output" */
const CHUNK = update({
	sessionUpdate: "agent_message_chunk",
	content: { type: "text", text: "I'll analyze your code for potential issues. Let me examine it..." },
});
/** protocol/v1/draft/tool-calls, "Creating" */
const TOOL_CALL = update({
	sessionUpdate: "tool_call",
	toolCallId: "call_001",
	title: "Reading configuration file",
	name: "read_file",
	kind: "read",
	status: "pending",
});
/** protocol/v1/draft/tool-calls, "Updating" */
const TOOL_PROGRESS = update({
	sessionUpdate: "tool_call_update",
	toolCallId: "call_001",
	status: "in_progress",
	content: [{ type: "content", content: { type: "text", text: "Found 3 configuration files..." } }],
});

/**
 * agy's questions as plan §3.5 describes them (`qN`, `qN_other`), each property as the v1 schema's own
 * `StringPropertySchema` (titled `oneOf`) and `MultiSelectPropertySchema` (titled `items.anyOf`) write it.
 */
const QUESTIONS = {
	jsonrpc: "2.0",
	id: 44,
	method: "elicitation/create",
	params: {
		sessionId: SESSION,
		mode: "form",
		message: "How should I refactor this?",
		requestedSchema: {
			type: "object",
			properties: {
				q1: {
					type: "string",
					title: "Approach",
					oneOf: [
						{ const: "conservative", title: "Conservative (Recommended)" },
						{ const: "aggressive", title: "Aggressive" },
					],
				},
				q2: {
					type: "array",
					title: "Areas",
					items: {
						anyOf: [
							{ const: "api", title: "API", description: "Routes and handlers" },
							{ const: "ui", title: "UI" },
						],
					},
				},
				q2_other: { type: "string", title: "Other" },
			},
			required: ["q1"],
		},
	},
};

function session() {
	const sent: Array<Record<string, unknown>> = [];
	const rpc = new JsonRpc(
		"agy",
		(record) => sent.push(JSON.parse(record)),
		() => undefined,
	);
	const live = new LiveState(emptySnapshot(), () => 1_000);
	const initial = live.snapshot();
	const records: SinkRecord[] = [];
	live.attach({ emit: (record) => records.push(record) });
	const prompts: Array<{ prompt: readonly object[]; answer: (result: RpcResult<PromptAnswer>) => void }> = [];
	const counts = { cancels: 0, ran: 0 };
	const asks = new AgyAsks({
		emit: (record) => live.emit(record.event, record.native, record.at),
		stopRun: () => turns.abort(),
		notice: (text) => live.emit({ type: "notice", level: "warning", text }),
		now: () => 1_000,
	});
	const turns: Turns = new Turns({
		sessionId: SESSION,
		asks,
		images: new PhoneImages(async (data, mimeType) => ({ ok: true, data, mimeType, originalBytes: 3, resized: false })),
		emit: (event) => live.emit(event),
		snapshot: () => live.snapshot(),
		request: (prompt) => new Promise((answer) => prompts.push({ prompt, answer })),
		cancel: () => {
			counts.cancels += 1;
		},
		commands: () => undefined,
		turnUsage: () => undefined,
		ran: () => {
			counts.ran += 1;
		},
		settled: () => undefined,
	});
	rpc.attach(SESSION, {
		update: (body) => turns.update(body),
		call: (call) => turns.call(call),
		fault: () => undefined,
	});
	const agy = (record: object) => rpc.receive({ kind: "line", text: JSON.stringify(record) });
	const ends = async (stopReason: string) => {
		prompts.at(-1)?.answer({ ok: true, result: { stopReason } });
		await Bun.sleep(0);
	};
	const types = () => records.map((record) => record.event.type);
	const violations = () => streamViolations(records, ANTIGRAVITY_TRAITS, initial);
	return { turns, asks, live, sent, prompts, counts, agy, ends, types, violations, records };
}

function start(text: string) {
	return { clientRequestId: crypto.randomUUID(), mode: "start" as const, text, attachments: [] };
}

function pendingAsk(live: LiveState): Interaction {
	const ask = live.snapshot().interactions[0];
	if (ask === undefined) throw new Error("no ask is pending");
	return ask;
}

describe("a live session's turns", () => {
	test("one prompt in flight: a run starts as it is sent, a second is busy, a repeat is the first's result", async () => {
		const { turns, prompts, agy, ends, types, violations, live } = session();
		const first = start("Can you analyze this code for potential issues?");
		expect(turns.prompt(first)).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts.map((sent) => sent.prompt)).toEqual([[{ type: "text", text: first.text }]]);
		expect(turns.prompt(start("and this?"))).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(turns.prompt(first)).toEqual({ status: "accepted", disposition: "started" });
		expect(prompts).toHaveLength(1);
		const echoed = live.snapshot().run?.items[0];
		expect(echoed).toMatchObject({ kind: "user_message", text: first.text, clientRequestId: first.clientRequestId });
		agy(CHUNK);
		agy(TOOL_CALL);
		agy(TOOL_PROGRESS);
		await ends("end_turn");
		expect(types()).toEqual([
			"run_started",
			"user_message",
			"block_started",
			"block_delta",
			"block_finished",
			"tool_started",
			"tool_updated",
			"tool_finished",
			"run_finished",
		]);
		expect(live.snapshot().lastOutcome).toEqual({ kind: "completed" });
		expect(violations()).toEqual([]);
		expect(turns.prompt(start("next"))).toEqual({ status: "accepted", disposition: "started" });
	});

	test("a permission is the person's to answer, and the answer goes back as ACP's selected outcome", async () => {
		const { turns, asks, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Read the configuration"));
		agy(TOOL_CALL);
		agy(PERMISSION);
		const ask = pendingAsk(live);
		expect(ask.request).toEqual({
			kind: "tool_permission",
			inputEditable: false,
			previews: [],
			options: [
				{ id: "allow-once", label: "Allow once", effect: "allow", scope: "once", stopsRun: false, message: "none" },
				{ id: "reject-once", label: "Reject", effect: "deny", scope: "once", stopsRun: false, message: "none" },
			],
			grants: [],
			deliberate: false,
		});
		expect(ask.blocksRun).toBe(true);
		expect(sent).toEqual([]);
		const reply = { kind: "tool_permission" as const, optionId: "allow-once", grantIds: [] };
		expect(asks.answer({ interactionId: ask.id, reply })).toEqual({ status: "accepted" });
		await Bun.sleep(0);
		// protocol/v1/draft/tool-calls: the client's answer
		expect(sent).toEqual([
			{ jsonrpc: "2.0", id: 5, result: { outcome: { outcome: "selected", optionId: "allow-once" } } },
		]);
		expect(asks.answer({ interactionId: ask.id, reply })).toMatchObject({ rejection: { code: "stale" } });
		await ends("end_turn");
		expect(violations()).toEqual([]);
	});

	test("a stop cancels the turn, answers its asks cancelled, and keeps what agy streams until the turn ends", async () => {
		const { turns, live, sent, counts, agy, ends, records, violations } = session();
		turns.prompt(start("Analyze it"));
		agy(CHUNK);
		agy(TOOL_CALL);
		agy(PERMISSION);
		expect(turns.abort()).toEqual({ status: "accepted" });
		expect(counts.cancels).toBe(1);
		// protocol/v1/draft/prompt-turn, "Cancellation": pending permissions are answered `cancelled`
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 5, result: { outcome: { outcome: "cancelled" } } }]);
		expect(live.snapshot().interactions).toEqual([]);
		expect(records.find((record) => record.event.type === "interaction_resolved")?.event).toMatchObject({
			reason: "withdrawn",
		});
		agy(CHUNK);
		expect(live.snapshot().blocks.map((block) => block.text)).toEqual([
			"I'll analyze your code for potential issues. Let me examine it...",
		]);
		await ends("cancelled");
		expect(live.snapshot().lastOutcome).toEqual({ kind: "aborted" });
		expect(live.snapshot().blocks).toEqual([]);
		expect(live.snapshot().tools).toEqual([]);
		expect(counts.ran).toBe(1);
		expect(violations()).toEqual([]);
	});

	test("an ask agy takes back is withdrawn and answered as ACP's cancellation says; a late answer is stale", async () => {
		const { turns, asks, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Read it"));
		agy(TOOL_CALL);
		agy(PERMISSION);
		const ask = pendingAsk(live);
		// schema/v1 CancelRequestNotification; protocol/v1/draft/cancellation: the receiver answers -32800
		agy({ jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: 5 } });
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 5, error: { code: -32800, message: "Request cancelled" } }]);
		expect(live.snapshot().interactions).toEqual([]);
		const reply = { kind: "tool_permission" as const, optionId: "allow-once", grantIds: [] };
		expect(asks.answer({ interactionId: ask.id, reply })).toMatchObject({ rejection: { code: "stale" } });
		await Bun.sleep(0);
		expect(sent).toHaveLength(1);
		await ends("end_turn");
		expect(violations()).toEqual([]);
	});

	test("a tool call that ends withdraws the ask it waited on, unanswered", async () => {
		const { turns, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Read it"));
		agy(TOOL_CALL);
		agy(PERMISSION);
		// protocol/v1/draft/prompt-turn, "5. Tool invocation and status reporting"
		agy(update({ sessionUpdate: "tool_call_update", toolCallId: "call_001", status: "completed" }));
		expect(live.snapshot().interactions).toEqual([]);
		expect(sent).toEqual([]);
		await ends("end_turn");
		expect(violations()).toEqual([]);
	});

	test("the session's process going ends the run failed, and its asks withdrawn", () => {
		const { turns, live, agy, violations } = session();
		turns.prompt(start("Read it"));
		agy(TOOL_CALL);
		agy(PERMISSION);
		turns.lose("agy exited with code 1");
		expect(live.snapshot().lastOutcome).toEqual({
			kind: "error",
			error: { code: "backend_unavailable", message: "the session's agy process stopped: agy exited with code 1" },
		});
		expect(live.snapshot().interactions).toEqual([]);
		expect(violations()).toEqual([]);
	});

	test("ACP's other stop reasons: the output limit is a limit, a refusal fails with what it means", async () => {
		const { turns, live, ends, records, violations } = session();
		turns.prompt(start("one"));
		await ends("max_tokens");
		expect(live.snapshot().lastOutcome).toEqual({ kind: "limit", limit: "output_tokens" });
		turns.prompt(start("two"));
		await ends("refusal");
		expect(live.snapshot().lastOutcome).toMatchObject({ kind: "error", error: { code: "content_filter" } });
		expect(records.some((record) => record.event.type === "notice")).toBe(true);
		expect(violations()).toEqual([]);
	});

	test("a form that is not agy's questions is dismissed at once, with a notice; ACP's own example is one", () => {
		const { turns, live, sent, agy, records } = session();
		turns.prompt(start("Refactor it"));
		// protocol/v1/draft/elicitation, "Form mode"
		agy({
			jsonrpc: "2.0",
			id: 43,
			method: "elicitation/create",
			params: {
				sessionId: SESSION,
				mode: "form",
				message: "How should I approach this refactoring?",
				requestedSchema: {
					type: "object",
					properties: { strategy: { type: "string", enum: ["conservative", "balanced", "aggressive"] } },
					required: ["strategy"],
				},
			},
		});
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 43, result: { action: "cancel" } }]);
		expect(live.snapshot().interactions).toEqual([]);
		expect(records.at(-1)?.event).toEqual({ type: "notice", level: "warning", text: UNSHOWN_QUESTION });
	});

	test("agy's questions are the contract's, and the answers go back as each choice's const and the person's words", async () => {
		const { turns, asks, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Refactor it"));
		agy(QUESTIONS);
		const ask = pendingAsk(live);
		expect(ask.request).toEqual({
			kind: "questions",
			questions: [
				{
					id: "q1",
					text: "Approach",
					options: [{ label: "Conservative (Recommended)" }, { label: "Aggressive" }],
					multiSelect: false,
					allowCustom: false,
					secret: false,
					required: true,
				},
				{
					id: "q2",
					text: "Areas",
					options: [{ label: "API", description: "Routes and handlers" }, { label: "UI" }],
					multiSelect: true,
					allowCustom: true,
					secret: false,
					required: false,
				},
			],
		});
		const answers = [
			{ questionId: "q1", selected: ["Conservative (Recommended)"] },
			{ questionId: "q2", selected: ["API", "UI"], custom: "the docs too" },
		];
		expect(asks.answer({ interactionId: ask.id, reply: { kind: "questions", answers } })).toEqual({
			status: "accepted",
		});
		await Bun.sleep(0);
		expect(sent).toEqual([
			{
				jsonrpc: "2.0",
				id: 44,
				result: { action: "accept", content: { q1: "conservative", q2: ["api", "ui"], q2_other: "the docs too" } },
			},
		]);
		agy({ ...QUESTIONS, id: 45 });
		const skipped = pendingAsk(live);
		asks.answer({ interactionId: skipped.id, reply: { kind: "cancel", stopRun: false } });
		await Bun.sleep(0);
		expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 45, result: { action: "decline" } });
		agy({ ...QUESTIONS, id: 46 });
		turns.abort();
		expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 46, result: { action: "cancel" } });
		await ends("cancelled");
		expect(violations()).toEqual([]);
	});

	test("a compaction is `/compact` as a prompt, shown as a compaction with agy's words as the command's output", async () => {
		const { turns, live, prompts, agy, ends, types, violations } = session();
		live.emit({ type: "usage_updated", usage: { contextTokens: 53_000, contextWindow: 200_000 } });
		expect(turns.compact("keep the API notes")).toEqual({ status: "accepted" });
		expect(prompts[0]?.prompt).toEqual([{ type: "text", text: "/compact keep the API notes" }]);
		expect(turns.prompt(start("go on"))).toMatchObject({ rejection: { code: "busy" } });
		agy(CHUNK);
		await ends("end_turn");
		expect(types().slice(1)).toEqual(["compaction_started", "compaction_finished", "activity"]);
		const finished = live.snapshot();
		expect(finished.compaction).toBeUndefined();
		expect(finished.run).toBeUndefined();
		expect(violations()).toEqual([]);
	});
});
