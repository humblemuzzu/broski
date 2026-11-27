/**
 * A live session's asks, over the bridge's JSON-RPC layer with ACP's documented records (`live-rig.ts`): each is the
 * person's to answer, one Broski cannot show included, and ends unanswered only when agy ends it.
 */

import { describe, expect, test } from "bun:test";
import { PERMISSION, pendingAsk, QUESTIONS, SESSION, session, start, TOOL_CALL, update } from "./live-rig";

describe("a live session's asks", () => {
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

	test("a form Broski can't show is still the person's, who can only decline it; ACP's own example is one", async () => {
		const { turns, asks, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Refactor it"));
		// protocol/v1/draft/elicitation, "Form mode"
		const form = {
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
		};
		agy(form);
		await Bun.sleep(0);
		expect(sent).toEqual([]);
		const ask = pendingAsk(live);
		expect(ask.title).toBe("Antigravity asked something Broski can't show");
		expect(ask.body).toContain("Nothing is answered for you.");
		expect(ask.request).toEqual({
			kind: "questions",
			questions: [
				{
					id: "request",
					text: "How should I approach this refactoring?",
					options: [{ label: "Decline" }],
					multiSelect: false,
					allowCustom: false,
					secret: false,
					required: true,
				},
			],
		});
		const decline = { kind: "questions" as const, answers: [{ questionId: "request", selected: ["Decline"] }] };
		expect(asks.answer({ interactionId: ask.id, reply: decline })).toEqual({ status: "accepted" });
		await Bun.sleep(0);
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 43, result: { action: "decline" } }]);
		agy({ ...form, id: 47 });
		asks.answer({ interactionId: pendingAsk(live).id, reply: { kind: "cancel", stopRun: false } });
		await Bun.sleep(0);
		expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 47, result: { action: "decline" } });
		agy({ ...form, id: 48 });
		asks.answer({ interactionId: pendingAsk(live).id, reply: { kind: "cancel", stopRun: true } });
		await Bun.sleep(0);
		expect(sent.at(-1)).toEqual({ jsonrpc: "2.0", id: 48, result: { action: "cancel" } });
		await ends("cancelled");
		expect(violations()).toEqual([]);
	});

	test("a permission none of whose options Broski can read waits for the person, who can refuse it", async () => {
		const { turns, asks, live, sent, agy, ends, violations } = session();
		turns.prompt(start("Read the configuration"));
		agy(TOOL_CALL);
		agy({ ...PERMISSION, params: { ...PERMISSION.params, options: [] } });
		await Bun.sleep(0);
		expect(sent).toEqual([]);
		const ask = pendingAsk(live);
		expect(ask.body).toContain("Nothing is answered for you.");
		expect(ask.request).toMatchObject({
			kind: "tool_permission",
			options: [{ id: "refuse", label: "Refuse", effect: "deny", scope: "once", stopsRun: false, message: "none" }],
		});
		const refuse = { kind: "tool_permission" as const, optionId: "refuse", grantIds: [] };
		expect(asks.answer({ interactionId: ask.id, reply: refuse })).toEqual({ status: "accepted" });
		await Bun.sleep(0);
		expect(sent).toEqual([{ jsonrpc: "2.0", id: 5, result: { outcome: { outcome: "cancelled" } } }]);
		await ends("end_turn");
		expect(violations()).toEqual([]);
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
});
