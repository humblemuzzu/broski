/**
 * What the live stream says and what the transcript read at `run_finished` says agree: a denied or aborted tool
 * call, a response that failed, a skill command, an extension's displayed message; and an ask that outlives the run
 * it was raised in still waits for its human.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { type SessionTitle, sessionStatus, type TranscriptItem } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { holdingRun } from "./helpers/live-steps";
import { allItems } from "./helpers/paging";
import { failWith, say, toolUse } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: LiveRig | undefined;
let d: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	await d?.dispose();
	t = undefined;
	d = undefined;
});

const resultOf = (items: readonly TranscriptItem[]) => items.find((item) => item.kind === "tool_result");

describe("a tool call's outcome", () => {
	test("denied by the human is denied live and in the transcript, though Pi stores an ordinary error result", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "interaction", interaction: "tool_permission" });
		await live.prompt("read it");
		const { interaction } = await live.waitFor("interaction_requested");
		await live.control.answer({
			interactionId: interaction.id,
			reply: { kind: "tool_permission", optionId: "deny", grantIds: [] },
		});

		const finished = await live.waitFor("tool_finished");
		expect(finished.outcome).toBe("denied");
		await live.waitFor("run_finished");
		expect(resultOf(await allItems(t.backend, live.ref, 200))).toMatchObject({
			kind: "tool_result",
			outcome: "denied",
		});
	});

	test("cut short by Stop is aborted live and in the transcript", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [toolUse(fauxToolCall("bash", { command: "sleep 30" })), say("never")]);
		await live.prompt("wait a while");
		await live.waitFor("tool_started", (event) => event.name === "bash");
		await live.waitFor("tool_updated", (event) => event.update.kind === "input");

		await live.control.abort();
		expect((await live.waitFor("tool_finished")).outcome).toBe("aborted");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("aborted");
		expect(resultOf(await allItems(t.backend, live.ref, 200))).toMatchObject({
			kind: "tool_result",
			outcome: "aborted",
		});
	});

	test("that simply failed stays failed: nothing is recorded for it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [toolUse(fauxToolCall("read", { path: "no-such-file" })), say("done")]);
		await live.run("read a missing file");
		expect(live.events().find((event) => event.type === "tool_finished")).toMatchObject({ outcome: "failed" });
		expect(resultOf(await allItems(t.backend, live.ref, 200))).toMatchObject({ outcome: "failed" });
	});
});

describe("a response that did not end normally", () => {
	test("leaves the terminal's own line in the transcript: the error, after what the response said", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [failWith("The provider fell over")]);
		const { outcome } = await live.run("try it");
		expect(outcome).toMatchObject({ kind: "error", error: { message: "The provider fell over" } });

		const [newest] = await allItems(t.backend, live.ref, 200);
		expect(newest).toMatchObject({ kind: "notice", level: "error", text: "Error: The provider fell over" });
	});
});

describe("a skill command", () => {
	test("is shown as it was typed, live and in the transcript; the model gets the skill itself", async () => {
		t = await LiveRig.create();
		const skills = join(t.world.env.agentDir, "skills", "tidy");
		mkdirSync(skills, { recursive: true });
		writeFileSync(
			join(skills, "SKILL.md"),
			"---\nname: tidy\ndescription: Tidy up\n---\nPut every file where it belongs.\n",
		);
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		const { outcome } = await live.runInput({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "the docs folder",
			attachments: [],
			command: "skill:tidy",
		});
		expect(outcome.kind).toBe("completed");

		const shown = live.events().find((event) => event.type === "user_message");
		expect(shown).toMatchObject({ text: "/skill:tidy the docs folder" });
		const stored = (await allItems(t.backend, live.ref, 200)).find((item) => item.kind === "user_message");
		expect(stored).toMatchObject({ text: "/skill:tidy the docs folder" });
		const sent = t.router.requests(live.ref.sessionId)[0]?.messages.findLast((message) => message.role === "user");
		expect(JSON.stringify(sent?.content)).toContain("Put every file where it belongs.");
	});

	test("titles the session as typed, on one line, the same live and listed", async () => {
		t = await LiveRig.create();
		const skills = join(t.world.env.agentDir, "skills", "tidy");
		mkdirSync(skills, { recursive: true });
		writeFileSync(join(skills, "SKILL.md"), "---\nname: tidy\ndescription: Tidy up\n---\nPut things away.\n");
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.runInput({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "the docs\n\n  folder",
			attachments: [],
			command: "skill:tidy",
		});
		const title: SessionTitle = { text: "/skill:tidy the docs folder", source: "first_prompt" };

		const announced = t.catalog.items.flatMap((event) =>
			event.type === "session_updated" && event.summary.session.sessionId === live.ref.sessionId
				? [event.summary.title]
				: [],
		);
		expect(announced.filter((shown) => shown !== undefined).at(-1)).toEqual(title);
		await live.close();
		await t.bus.shutDown(live.ref.sessionId);
		const listed = await t.backend.getSession(live.ref);
		expect(listed.status === "accepted" && listed.summary.title).toEqual(title);
	});
});

describe("an extension's message with display on", () => {
	test("is a notice live and the same notice in the transcript", async () => {
		d = await HostRig.create();
		const live = await d.rig.rig.openNew();
		await d.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("first, so the session is on disk");

		expect(
			await live.control.prompt({
				clientRequestId: crypto.randomUUID(),
				mode: "start",
				text: "",
				attachments: [],
				command: "ext:note",
			}),
		).toMatchObject({ disposition: "handled" });
		const notice = await live.waitFor("notice", (event) => event.text === "a note");
		expect(notice.level).toBe("info");
		const [newest] = await allItems(d.rig.backend, live.ref, 200);
		expect(newest).toMatchObject({ kind: "notice", level: "info", text: "a note" });
	});
});

describe("an extension command's dialog raised during a run", () => {
	test("is not the run's: it names no run and blocks none, outlives a Stop under its own id, and its answer reaches the extension", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		expect(
			await live.control.prompt({
				clientRequestId: crypto.randomUUID(),
				mode: "start",
				text: "",
				attachments: [],
				command: "ext:drv-ask",
			}),
		).toMatchObject({ disposition: "handled" });
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction).toMatchObject({ title: "Proceed?", blocksRun: false });
		expect(interaction).not.toHaveProperty("runId");
		expect(sessionStatus(live.reduced())).toBe("running");

		expect(await live.control.abort()).toEqual({ status: "accepted" });
		await live.waitFor("run_finished");
		expect(live.events().some((event) => event.type === "interaction_resolved")).toBe(false);
		expect(live.reduced().interactions.map((pending) => pending.id)).toEqual([interaction.id]);
		expect(t.bus.asks).toEqual([]);

		expect(
			await live.control.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } }),
		).toEqual({ status: "accepted" });
		expect(await t.bus.answered("drv-ask")).toEqual({ tag: "drv-ask", answer: true });
		live.assertSettled();
	});

	test("a dialog the command raises after it awaited something is not the run's either", async () => {
		d = await HostRig.create();
		const live = await d.rig.rig.openNew();
		await d.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("hold on");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		await live.control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "",
			attachments: [],
			command: "ext:ask-later",
		});
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction).toMatchObject({ title: "Later?", blocksRun: false });
		expect(interaction).not.toHaveProperty("runId");
		await live.control.answer({ interactionId: interaction.id, reply: { kind: "confirm", confirmed: true } });
		await live.control.abort();
		await live.waitFor("run_finished");
		expect(d.state.answers).toEqual([true]);
	});
});
