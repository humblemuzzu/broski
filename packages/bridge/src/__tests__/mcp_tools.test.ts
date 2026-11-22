/**
 * The three tools on a real port: what reaches the bridge, what the agent gets back, the progress heartbeat that
 * keeps a waiting call alive, and the client hanging up or cancelling, which withdraws the card.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { callOf, McpRig, SESSION, sseMessages } from "./helpers/mcp-rig";

let rig: McpRig | undefined;

afterEach(() => {
	rig?.stop();
	rig = undefined;
});

function aborted(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function started(heartbeatMs?: number): McpRig {
	rig = new McpRig(heartbeatMs);
	return rig;
}

const STORE = {
	title: "Database choice",
	questions: [
		{
			id: "db",
			header: "Database",
			text: "Which database should we use?",
			options: [{ label: "SQLite", description: "Zero setup" }, { label: "Postgres" }],
		},
	],
};

interface CallResult {
	readonly content: { readonly type: string; readonly text: string }[];
	readonly structuredContent?: Record<string, unknown>;
	readonly isError: boolean;
}

async function jsonCall(t: McpRig, token: string, name: string, args: unknown): Promise<CallResult> {
	const response = await t.post(token, callOf(name, args), { accept: "application/json" });
	expect(response.headers.get("content-type")).toContain("application/json");
	return ((await response.json()) as { result: CallResult }).result;
}

describe("broski_ask", () => {
	test("waits on an SSE stream with a rising progress heartbeat, then ends with the answers", async () => {
		const t = started(20);
		const { token } = t.issue({ ask: true });
		const response = await t.post(token, callOf("broski_ask", STORE, { progressToken: "tok-7" }));
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const messages = sseMessages(response);
		const raised = await t.sink.nth(1);
		expect(raised.session).toEqual(SESSION);
		expect(raised.spec).toEqual({
			title: "Database choice",
			blocksRun: true,
			origin: { toolName: "broski_ask" },
			request: {
				kind: "questions",
				questions: [
					{
						id: "db",
						header: "Database",
						text: "Which database should we use?",
						options: [{ label: "SQLite", description: "Zero setup" }, { label: "Postgres" }],
						multiSelect: false,
						allowCustom: true,
						secret: false,
						required: true,
					},
				],
			},
		});
		const beats = [(await messages.next()).value, (await messages.next()).value];
		expect(beats).toEqual(
			[1, 2].map((progress) => ({
				jsonrpc: "2.0",
				method: "notifications/progress",
				params: { progressToken: "tok-7", progress, message: "Waiting for the user's answer on Broski" },
			})),
		);

		raised.answer({ kind: "questions", answers: [{ questionId: "db", selected: ["SQLite"], custom: "" }] });
		let last: Record<string, unknown> | undefined;
		for await (const message of messages) last = message;
		expect(last).toMatchObject({ jsonrpc: "2.0", id: 7 });
		const result = last?.result as CallResult;
		expect(result.structuredContent).toEqual({ status: "answered", answers: [{ id: "db", selected: ["SQLite"] }] });
		expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent ?? {});
		expect(raised.signal.aborted).toBe(false);
	});

	test("a client that takes JSON only gets one JSON answer once the person answers", async () => {
		const t = started();
		const { token } = t.issue({ ask: true });
		const pending = jsonCall(t, token, "broski_ask", STORE);
		const raised = await t.sink.nth(1);
		raised.answer({ kind: "cancel", stopRun: false, message: "Not now." });
		expect((await pending).structuredContent).toEqual({ status: "cancelled", message: "Not now." });
	});

	test("the client hanging up a stream withdraws the question", async () => {
		const t = started(20);
		const { token } = t.issue({ ask: true });
		const hangUp = new AbortController();
		const response = await t.post(token, callOf("broski_ask", STORE), {}, hangUp.signal);
		const raised = await t.sink.nth(1);
		await response.body?.getReader().read();
		expect(raised.signal.aborted).toBe(false);
		hangUp.abort();
		await aborted(raised.signal);
	});

	test("the client hanging up a JSON call withdraws the question", async () => {
		const t = started();
		const { token } = t.issue({ ask: true });
		const hangUp = new AbortController();
		const pending = t.post(token, callOf("broski_ask", STORE), { accept: "application/json" }, hangUp.signal);
		const raised = await t.sink.nth(1);
		hangUp.abort();
		await pending.catch(() => undefined);
		await aborted(raised.signal);
	});

	test("notifications/cancelled withdraws the question and the call ends cancelled", async () => {
		const t = started();
		const { token } = t.issue({ ask: true });
		const pending = t.post(token, callOf("broski_ask", STORE, undefined, "call-1"), { accept: "application/json" });
		const raised = await t.sink.nth(1);
		const other = t.issue({ ask: true });
		await t.post(other.token, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call-1" } });
		expect(raised.signal.aborted).toBe(false);
		await t.post(token, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "call-1" } });
		expect(raised.signal.aborted).toBe(true);
		const { result } = (await (await pending).json()) as { result: CallResult };
		expect(result.structuredContent).toEqual({
			status: "cancelled",
			message: "It was withdrawn before the user answered.",
		});
	});

	test("escapes, controls and bidi overrides never reach the phone", async () => {
		const t = started();
		const { token } = t.issue({ ask: true });
		const hostile = {
			title: "\u001b[31mDanger\u001b[0m\u202e",
			questions: [
				{ id: "a\u0007", text: "Pick\u0000 one\n\tplease\u2066", options: [{ label: "\u001b]0;x\u0007Yes" }] },
			],
		};
		const pending = jsonCall(t, token, "broski_ask", hostile);
		const raised = await t.sink.nth(1);
		expect(raised.spec.title).toBe("Danger");
		expect(raised.spec.request).toMatchObject({
			questions: [{ id: "a", text: "Pick one\n\tplease", options: [{ label: "Yes" }] }],
		});
		raised.answer({ kind: "questions", answers: [{ questionId: "a", selected: ["Yes"] }] });
		expect((await pending).structuredContent).toEqual({
			status: "answered",
			answers: [{ id: "a", selected: ["Yes"] }],
		});
	});

	test.each([
		[
			"duplicate question ids",
			{
				title: "t",
				questions: [
					{ id: "a", text: "x" },
					{ id: "a", text: "y" },
				],
			},
		],
		[
			"duplicate option labels",
			{ title: "t", questions: [{ id: "a", text: "x", options: [{ label: "Yes" }, { label: "Yes" }] }] },
		],
		["no way to answer", { title: "t", questions: [{ id: "a", text: "x", allowCustom: false }] }],
		["no questions", { title: "t", questions: [] }],
		["eleven questions", { title: "t", questions: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, text: "x" })) }],
		["a long title", { title: "t".repeat(121), questions: [{ id: "a", text: "x" }] }],
		["an invisible title", { title: "\u202e\u0007", questions: [{ id: "a", text: "x" }] }],
	])("%s is a tool error the model can read, and nothing is asked", async (_, args) => {
		const t = started();
		const result = await jsonCall(t, t.issue({ ask: true }).token, "broski_ask", args);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).not.toBe("");
		expect(t.sink.raised).toHaveLength(0);
	});
});

describe("broski_propose_plan", () => {
	test("asks for plan approval and returns the decision with the edited plan", async () => {
		const t = started();
		const { token } = t.issue({ plan: true });
		const pending = jsonCall(t, token, "broski_propose_plan", { title: "Refactor", plan: "# Plan\n1. Do it" });
		const raised = await t.sink.nth(1);
		expect(raised.spec).toEqual({
			title: "Refactor",
			blocksRun: true,
			origin: { toolName: "broski_propose_plan" },
			request: { kind: "plan_approval", plan: "# Plan\n1. Do it", editable: true },
		});
		raised.answer({ kind: "plan_approval", decision: "approve", plan: "# Plan\n1. Do it well" });
		expect((await pending).structuredContent).toEqual({ decision: "approve", plan: "# Plan\n1. Do it well" });
	});

	test("a rejection carries the feedback; an expired card is cancelled", async () => {
		const t = started();
		const { token } = t.issue({ plan: true });
		const rejected = jsonCall(t, token, "broski_propose_plan", { title: "A", plan: "p" });
		(await t.sink.nth(1)).answer({ kind: "plan_approval", decision: "reject", feedback: "Smaller steps." });
		expect((await rejected).structuredContent).toEqual({ decision: "reject", feedback: "Smaller steps." });
		const expired = jsonCall(t, token, "broski_propose_plan", { title: "B", plan: "p" });
		(await t.sink.nth(2)).expire();
		expect((await expired).structuredContent).toEqual({
			decision: "cancelled",
			message: "It expired before the user answered.",
		});
	});
});

describe("broski_notify", () => {
	test("sends one notice and answers at once, urgent only when asked", async () => {
		const t = started();
		const { token } = t.issue({ notify: true });
		const sent = await jsonCall(t, token, "broski_notify", { title: "Build done", body: "All green", urgency: "high" });
		expect(sent.structuredContent).toEqual({ sent: true });
		await jsonCall(t, token, "broski_notify", { title: "Step 2\u001b[0m" });
		expect(t.sink.notices).toEqual([
			{ session: SESSION, notice: { level: "info", text: "Build done\nAll green", urgent: true } },
			{ session: SESSION, notice: { level: "info", text: "Step 2", urgent: false } },
		]);
		expect(t.sink.raised).toHaveLength(0);
	});

	test("a notice the bridge refuses is a tool error, not a false `sent`", async () => {
		const t = started();
		t.sink.noticeResult = { status: "rejected", rejection: { code: "closed", message: "The session is closed." } };
		const result = await jsonCall(t, t.issue({ notify: true }).token, "broski_notify", { title: "Hi" });
		expect(result).toEqual({ content: [{ type: "text", text: "The session is closed." }], isError: true });
	});

	test("a body past 500 characters is refused", async () => {
		const t = started();
		const result = await jsonCall(t, t.issue({ notify: true }).token, "broski_notify", {
			title: "Hi",
			body: "b".repeat(501),
		});
		expect(result.isError).toBe(true);
		expect(t.sink.notices).toHaveLength(0);
	});
});
