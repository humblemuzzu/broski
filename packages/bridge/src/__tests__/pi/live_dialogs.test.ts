/**
 * On the real adapter: every Pi dialog kind reaching the phone and its answer
 * reaching the extension, a cancel, the extension's own timeout (and nothing else's), its signal, a
 * shutdown, two clients, and a dialog outside any run.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopHolders } from "../../backends/pi/holder/holders";
import { SETTLE_DEADLINE_MS } from "../../backends/pi/live/session-host";
import { EXIT_AFTER_EOF_MS } from "../../backends/pi/rpc/child";
import { type Interaction, type InteractionReply, sessionStatus } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import type { ScriptedTurn } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { countOf } from "./helpers/live-steps";
import { askHuman, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

interface Asked {
	readonly live: LiveSession;
	readonly interaction: Interaction;
}

/** A new session whose one prompt makes the extension open `dialog`, and the dialog it raised. */
async function asked(rig: LiveRig, dialog: ScriptedTurn): Promise<Asked> {
	const live = await rig.rig.openNew();
	rig.router.script(live.ref.sessionId, [dialog, say("Thanks.")]);
	await live.prompt("Ask me.");
	const requested = await live.waitFor("interaction_requested");
	return { live, interaction: requested.interaction };
}

function answerTo(interaction: Interaction, reply: InteractionReply) {
	return { interactionId: interaction.id, reply };
}

function choiceValue(interaction: Interaction, label: string): string {
	const request = interaction.request;
	if (request.kind !== "choice") throw new Error(`asked a ${request.kind}`);
	const option = request.options.find((candidate) => candidate.label === label);
	if (!option) throw new Error(`no option ${label}`);
	return option.value;
}

describe("each dialog kind reaches the phone and its answer reaches the extension", () => {
	test("select is a choice: the options are the extension's strings, the answer comes back as the string", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Pick one", { options: ["retry", "edit"], tag: "pick" }),
		);
		expect(interaction).toMatchObject({ title: "Pick one", blocksRun: true, runId: live.reduced().run?.runId });
		expect(interaction.expiresAt).toBeUndefined();
		expect(interaction.request.kind === "choice" && interaction.request.options.map((option) => option.label)).toEqual([
			"retry",
			"edit",
		]);
		expect(sessionStatus(live.session.snapshot())).toBe("waiting_for_user");

		const reply = { kind: "choice", value: choiceValue(interaction, "edit") } as const;
		expect((await live.control.answer(answerTo(interaction, reply))).status).toBe("accepted");
		expect((await live.waitFor("interaction_resolved")).reason).toBe("answered");
		expect((await t.router.answered("pick")).answer).toBe("edit");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test("questions on broski:questions are one questions card, and the pick comes back as the answers", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("questions", "Which store?", { options: ["SQLite", "Redis"], tag: "store" }),
		);
		expect(interaction).toMatchObject({
			title: "Which store?",
			blocksRun: true,
			request: {
				kind: "questions",
				questions: [
					{
						id: "0",
						text: "Which store?",
						options: [{ label: "SQLite" }, { label: "Redis" }],
						multiSelect: false,
						allowCustom: true,
					},
				],
			},
		});
		const reply: InteractionReply = { kind: "questions", answers: [{ questionId: "0", selected: ["Redis"] }] };
		expect((await live.control.answer(answerTo(interaction, reply))).status).toBe("accepted");
		expect(JSON.parse(String((await t.router.answered("store")).answer))).toEqual([{ selected: ["Redis"] }]);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test.each([{ confirmed: true }, { confirmed: false }])("confirm is a confirm: %p comes back as that boolean", async ({
		confirmed,
	}) => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(t, askHuman("confirm", "Sure?", { tag: "sure" }));
		expect(interaction.request.kind).toBe("confirm");
		await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed }));
		expect((await t.router.answered("sure")).answer).toBe(confirmed);
		await live.waitFor("run_finished");
	});

	test("input is one line of text, and editor is multiline text with its prefill", async () => {
		t = await LiveRig.create();
		const single = await asked(t, askHuman("input", "Name?", { tag: "name" }));
		expect(single.interaction.request).toMatchObject({ kind: "text", multiline: false });
		await single.live.control.answer(answerTo(single.interaction, { kind: "text", text: "Ada" }));
		expect((await t.router.answered("name")).answer).toBe("Ada");
		await single.live.waitFor("run_finished");

		const multi = await asked(t, askHuman("editor", "Edit", { tag: "edit" }));
		expect(multi.interaction.request).toMatchObject({ kind: "text", multiline: true, initialText: "prefilled" });
		await multi.live.control.answer(answerTo(multi.interaction, { kind: "text", text: "line one\nline two" }));
		expect((await t.router.answered("edit")).answer).toBe("line one\nline two");
		await multi.live.waitFor("run_finished");
	});

	test("styled text from an extension reaches the phone without terminal escapes", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("confirm", "\u001b[31mRed\u001b[0m question", { tag: "red" }),
		);
		expect(interaction.title).toBe("Red question");
		await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed: true }));
		await live.waitFor("run_finished");
	});

	test("a select with nothing to choose from is answered with Pi's default and never asked", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [askHuman("select", "Nothing", { options: [], tag: "none" }), say("Done.")]);
		await live.prompt("Ask me.");
		expect((await t.router.answered("none")).answer).toBeNull();
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(live.events().some((event) => event.type === "interaction_requested")).toBe(false);
	});
});

describe("a cancel", () => {
	test.each([
		{ dialog: "select", options: ["a", "b"], fallback: null },
		{ dialog: "confirm", options: undefined, fallback: false },
		{ dialog: "input", options: undefined, fallback: null },
		{ dialog: "editor", options: undefined, fallback: null },
	] as const)("of a $dialog gives the extension Pi's default, and the run goes on unless it was stopped", async ({
		dialog,
		options,
		fallback,
	}) => {
		t = await LiveRig.create();
		const first = await asked(
			t,
			askHuman(dialog, "Cancel me", { ...(options && { options: [...options] }), tag: `cancel-${dialog}` }),
		);
		await first.live.control.answer(answerTo(first.interaction, { kind: "cancel", stopRun: false }));
		expect((await t.router.answered(`cancel-${dialog}`)).answer).toBe(fallback);
		expect((await first.live.waitFor("run_finished")).outcome.kind).toBe("completed");

		const second = await asked(
			t,
			askHuman(dialog, "Cancel me", { ...(options && { options: [...options] }), tag: `stop-${dialog}` }),
		);
		await second.live.control.answer(answerTo(second.interaction, { kind: "cancel", stopRun: true }));
		expect((await second.live.waitFor("run_finished")).outcome.kind).toBe("aborted");
		second.live.assertSettled();
	});
});

describe("what ends a dialog without the human", () => {
	test("the extension's own timeout withdraws it at its deadline, and nothing withdraws another dialog", async () => {
		t = await LiveRig.create();
		const patient = await asked(t, askHuman("select", "Take your time", { options: ["a"], tag: "patient" }));
		expect(patient.interaction.expiresAt).toBeUndefined();
		const hurried = await asked(t, askHuman("select", "Hurry", { options: ["a"], timeoutMs: 1_000, tag: "hurry" }));
		expect((hurried.interaction.expiresAt ?? 0) - hurried.interaction.createdAt).toBe(1_000);

		const resolved = await hurried.live.waitFor("interaction_resolved");
		expect(resolved.reason).toBe("withdrawn");
		expect(Date.now()).toBeGreaterThanOrEqual(hurried.interaction.expiresAt ?? Number.POSITIVE_INFINITY);
		expect((await t.router.answered("hurry")).answer).toBeNull();
		expect((await hurried.live.waitFor("run_finished")).outcome.kind).toBe("completed");

		expect(patient.live.session.snapshot().interactions.map((interaction) => interaction.id)).toEqual([
			patient.interaction.id,
		]);
		await patient.live.control.answer(
			answerTo(patient.interaction, { kind: "choice", value: choiceValue(patient.interaction, "a") }),
		);
		expect((await t.router.answered("patient")).answer).toBe("a");
	});

	// Pi tells its client nothing when a dialog's own signal ends it (pi-coding-agent 1.5.2
	// `dist/modes/rpc/rpc-mode.js:51-82`), so the bridge cannot tell it from a dialog still waiting: when the run ends,
	// the ask is raised again on its own, and only a human ends it.
	test("one a signal of the extension's own ends outlives its run as an ask of its own, which a human ends", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Mine", { options: ["a"], abortAfterMs: 300, tag: "mine" }),
		);
		expect((await t.router.answered("mine")).answer).toBeNull();
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		const resolved = live
			.events()
			.find((event) => event.type === "interaction_resolved" && event.interactionId === interaction.id);
		expect(resolved).toMatchObject({ reason: "withdrawn" });
		const [again] = live.session.snapshot().interactions;
		expect(again).toMatchObject({ title: "Mine", blocksRun: false });
		expect(again?.runId).toBeUndefined();
		if (!again) throw new Error("the ask was not raised again");
		await live.control.answer(answerTo(again, { kind: "choice", value: choiceValue(again, "a") }));
		expect((await live.waitFor("interaction_resolved", (event) => event.interactionId === again.id)).reason).toBe(
			"answered",
		);
		live.assertSettled();
	});

	test.each([
		{ withSignal: true },
		{ withSignal: false },
	])("an abort withdraws it whether or not the extension passed its signal ($withSignal)", async ({ withSignal }) => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Abort me", { options: ["a"], withSignal, tag: "abort" }),
		);
		await live.control.abort();
		const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === interaction.id);
		expect(resolved.reason).toBe("withdrawn");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("aborted");
		expect((await t.router.answered("abort")).answer).toBeNull();
		live.assertSettled();
	});

	// On stdin EOF Pi runs `session_shutdown`, and a dialog asked from it can never be answered: Pi exits once its event
	// loop is empty, with the handler still waiting (pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:597-610,666-669`).
	test("a shutdown leaves it open in its holder; stopping that pi answers it with Pi's default at once, and one asked from the shutdown handler holds nothing up", async () => {
		t = await LiveRig.create();
		writeFileSync(join(t.world.env.agentDir, "ask-on-shutdown"), "");
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Still here?", { options: ["a"], tag: "shutdown-select" }),
		);
		const began = performance.now();
		await t.backend.dispose();
		expect(performance.now() - began).toBeLessThan(SETTLE_DEADLINE_MS);
		const resolved = live
			.events()
			.filter((event) => event.type === "interaction_resolved" && event.interactionId === interaction.id);
		expect(resolved).toEqual([]);
		const stopping = performance.now();
		await stopHolders(t.world.holdersRoot);
		expect(performance.now() - stopping).toBeLessThan(EXIT_AFTER_EOF_MS + 500);
		expect((await t.router.answered("shutdown-select")).answer).toBeNull();
		const raised = live.events().filter((event) => event.type === "interaction_requested");
		expect(raised.map((event) => event.type === "interaction_requested" && event.interaction.title)).toEqual([
			"Still here?",
		]);
		expect(t.router.asks.some((ask) => ask.tag === "shutdown")).toBe(false);
	});
});

describe("a dialog answered twice, and one outside a run", () => {
	test("the first answer wins and the second is stale; there is one resolution", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(t, askHuman("confirm", "Who answers?", { tag: "race" }));
		const early = await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed: true }));
		const late = await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed: false }));
		const unknown = await live.control.answer(
			answerTo({ ...interaction, id: "no-such-interaction" }, { kind: "confirm", confirmed: true }),
		);
		expect(early.status).toBe("accepted");
		expect(late).toMatchObject({ status: "rejected", rejection: { code: "stale" } });
		expect(unknown).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });

		expect((await t.router.answered("race")).answer).toBe(true);
		await live.waitFor("run_finished");
		const resolutions = live.events().filter((event) => event.type === "interaction_resolved");
		expect(resolutions).toEqual([{ type: "interaction_resolved", interactionId: interaction.id, reason: "answered" }]);
	});

	test("one pending when the session is closed is in the next open's snapshot, and only that view can answer it", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(t, askHuman("confirm", "Still there?", { tag: "kept" }));
		await live.close();
		const reopened = await t.rig.open(live.ref);
		expect(reopened.initial.interactions.map((pending) => pending.id)).toEqual([interaction.id]);

		const stale = await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed: false }));
		expect(stale).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
		expect((await reopened.control.answer(answerTo(interaction, { kind: "confirm", confirmed: true }))).status).toBe(
			"accepted",
		);
		expect((await t.router.answered("kept")).answer).toBe(true);
		expect((await reopened.waitFor("run_finished")).outcome.kind).toBe("completed");
	});

	test("an extension command's dialog has no run and blocks nothing", async () => {
		t = await LiveRig.create();
		const listed = await t.backend.listCommands({ cwd: t.cwd });
		if (listed.status === "rejected") throw new Error(listed.rejection.message);
		const command = listed.commands.find((candidate) => candidate.id === "ext:drv-ask")?.id;
		if (command === undefined) throw new Error("drv-ask is not listed");
		const live = await t.rig.openNew();
		const result = await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "",
			attachments: [],
			command,
		});
		expect(result).toEqual({ status: "accepted", disposition: "handled" });

		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction.runId).toBeUndefined();
		expect(interaction.blocksRun).toBe(false);
		expect(sessionStatus(live.session.snapshot())).toBe("idle");
		await live.control.answer(answerTo(interaction, { kind: "confirm", confirmed: true }));
		expect((await t.router.answered("drv-ask")).answer).toBe(true);
		expect((await live.waitFor("interaction_resolved")).reason).toBe("answered");
		expect(countOf(live, "run_started")).toBe(0);
	});
});
