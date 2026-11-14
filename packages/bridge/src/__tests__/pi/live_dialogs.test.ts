/**
 * On the real adapter: every Pi dialog kind reaching the phone and its answer
 * reaching the extension, a cancel, the extension's own timeout (and nothing else's), its signal, a
 * shutdown, two clients, and a dialog outside any run.
 */

import { afterEach, describe, expect, jest, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SETTLE_DEADLINE_MS } from "../../backends/pi/live/shutdown";
import { type Interaction, type InteractionReply, sessionStatus } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { countOf } from "./helpers/live-steps";
import { askHuman, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	jest.useRealTimers();
	await t?.dispose();
	t = undefined;
});

interface Asked {
	readonly live: LiveSession;
	readonly interaction: Interaction;
}

/** A new session whose one prompt makes the extension open `dialog`, and the dialog it raised. */
async function asked(rig: LiveRig, dialog: AssistantMessage): Promise<Asked> {
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
		expect((await t.bus.answered("pick")).answer).toBe("edit");
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
		expect((await t.bus.answered("sure")).answer).toBe(confirmed);
		await live.waitFor("run_finished");
	});

	test("input is one line of text, and editor is multiline text with its prefill", async () => {
		t = await LiveRig.create();
		const single = await asked(t, askHuman("input", "Name?", { tag: "name" }));
		expect(single.interaction.request).toMatchObject({ kind: "text", multiline: false });
		await single.live.control.answer(answerTo(single.interaction, { kind: "text", text: "Ada" }));
		expect((await t.bus.answered("name")).answer).toBe("Ada");
		await single.live.waitFor("run_finished");

		const multi = await asked(t, askHuman("editor", "Edit", { tag: "edit" }));
		expect(multi.interaction.request).toMatchObject({ kind: "text", multiline: true, initialText: "prefilled" });
		await multi.live.control.answer(answerTo(multi.interaction, { kind: "text", text: "line one\nline two" }));
		expect((await t.bus.answered("edit")).answer).toBe("line one\nline two");
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
		expect((await t.bus.answered("none")).answer).toBeUndefined();
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(live.events().some((event) => event.type === "interaction_requested")).toBe(false);
	});
});

describe("a cancel", () => {
	test.each([
		{ dialog: "select", options: ["a", "b"], fallback: undefined },
		{ dialog: "confirm", options: undefined, fallback: false },
		{ dialog: "input", options: undefined, fallback: undefined },
		{ dialog: "editor", options: undefined, fallback: undefined },
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
		expect((await t.bus.answered(`cancel-${dialog}`)).answer).toBe(fallback);
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
	// Fake timers are the process's: a 7-day advance once fired a 16 ms retry loop an earlier file's congested link
	// socket left behind tens of millions of times, holding the loop past the watchdog. Ten minutes (the plan's own
	// on-device wait) passes every deadline the adapter sets; that an ask without a timeout sets none at all is
	// `interaction_desk.test.ts`'s to prove.
	test("the extension's own timeout withdraws it at its deadline, and no timer of the adapter's answers another dialog", async () => {
		t = await LiveRig.create();
		jest.useFakeTimers();
		const patient = await asked(t, askHuman("select", "Take your time", { options: ["a"], tag: "patient" }));
		expect(patient.interaction.expiresAt).toBeUndefined();
		const hurried = await asked(t, askHuman("select", "Hurry", { options: ["a"], timeoutMs: 300, tag: "hurry" }));
		expect((hurried.interaction.expiresAt ?? 0) - hurried.interaction.createdAt).toBe(300);

		jest.advanceTimersByTime(299);
		await t.driver.quiesce();
		expect(hurried.live.session.snapshot().interactions).toHaveLength(1);
		jest.advanceTimersByTime(1);
		expect((await hurried.live.waitFor("interaction_resolved")).reason).toBe("withdrawn");
		expect((await t.bus.answered("hurry")).answer).toBeUndefined();
		expect((await hurried.live.waitFor("run_finished")).outcome.kind).toBe("completed");

		jest.advanceTimersByTime(10 * 60_000);
		await t.driver.quiesce();
		expect(patient.live.session.snapshot().interactions.map((interaction) => interaction.id)).toEqual([
			patient.interaction.id,
		]);
		await patient.live.control.answer(
			answerTo(patient.interaction, { kind: "choice", value: choiceValue(patient.interaction, "a") }),
		);
		expect((await t.bus.answered("patient")).answer).toBe("a");
	});

	test("a signal of the extension's own withdraws it and the run goes on", async () => {
		t = await LiveRig.create();
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Mine", { options: ["a"], ownSignal: true, tag: "mine" }),
		);
		t.bus.abortOwn("mine");
		const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === interaction.id);
		expect(resolved.reason).toBe("withdrawn");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect((await t.bus.answered("mine")).answer).toBeUndefined();
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
		expect((await t.bus.answered("abort")).answer).toBeUndefined();
		live.assertSettled();
	});

	test("a shutdown answers it with Pi's default at once, even one asked from the shutdown handler itself", async () => {
		t = await LiveRig.create();
		t.bus.askOnShutdown = true;
		const { live, interaction } = await asked(
			t,
			askHuman("select", "Still here?", { options: ["a"], tag: "shutdown-select" }),
		);
		const began = performance.now();
		await t.backend.dispose();
		expect(performance.now() - began).toBeLessThan(SETTLE_DEADLINE_MS);
		expect((await t.bus.answered("shutdown-select")).answer).toBeUndefined();
		expect((await t.bus.answered("shutdown")).answer).toBe(false);
		const resolved = live
			.events()
			.filter((event) => event.type === "interaction_resolved" && event.interactionId === interaction.id);
		expect(resolved.every((event) => event.type === "interaction_resolved" && event.reason === "expired")).toBe(true);
		expect(t.bus.liveRuntimes()).toBe(0);
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

		expect((await t.bus.answered("race")).answer).toBe(true);
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
		expect((await t.bus.answered("kept")).answer).toBe(true);
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
		expect((await t.bus.answered("drv-ask")).answer).toBe(true);
		expect((await live.waitFor("interaction_resolved")).reason).toBe("answered");
		expect(countOf(live, "run_started")).toBe(0);
	});
});
