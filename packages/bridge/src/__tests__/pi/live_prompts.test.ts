/**
 * On the real adapter: a repeated `clientRequestId`, an image for a model
 * that cannot see, and commands against text that merely looks like one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { PromptInput } from "../../contract";
import { canonical, promptInput } from "../../contract/testing/conformance-harness";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { LiveRig } from "./helpers/live-rig";
import { countOf, holdingRun, userMessages } from "./helpers/live-steps";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("a repeated clientRequestId", () => {
	test("after its run has ended, a repeat returns the first result and starts nothing", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		const id = crypto.randomUUID();
		const first = await live.prompt("Once.", "start", id);
		await live.runAfter(0);
		const again = await live.prompt("Once.", "start", id);
		expect(canonical(again)).toBe(canonical(first));
		await t.driver.quiesce();
		expect(countOf(live, "run_started")).toBe(1);
		expect(userMessages(live).filter((message) => message.clientRequestId === id)).toHaveLength(1);
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(1);
	});

	test("across a close and reopen while the run goes on, a repeat is the first result, not busy", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		const id = userMessages(live)[0]?.clientRequestId;
		if (id === undefined) throw new Error("the held prompt has no clientRequestId");
		await live.close();
		const reopened = await t.rig.open(live.ref);
		const repeat = await reopened.control.prompt(promptInput("Work for a while.", "start", id));
		expect(repeat).toEqual({ status: "accepted", disposition: "started" });
		await t.driver.quiesce();
		expect(countOf(reopened, "run_started")).toBe(0);
		expect(userMessages(reopened)).toEqual([]);
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(1);
		await reopened.control.abort();
		await reopened.waitFor("run_finished");
	});

	test("the transcript names the clientRequestId after the bridge restarts", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		const { clientRequestId } = await live.run("Remember me.");
		await t.rig.restart();
		const page = await t.backend.readTranscript(live.ref, { limit: 200 });
		if (page.status === "rejected") throw new Error(page.rejection.message);
		const prompts = page.page.items.filter((item) => item.kind === "user_message");
		expect(prompts.map((item) => item.clientRequestId)).toEqual([clientRequestId]);
	});
});

describe("an image for a model that cannot see", () => {
	test("is refused before anything reaches the model, not remembered, and fine once the model is switched", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.blind) });
		const input: PromptInput = promptInput("Look.", "start", crypto.randomUUID(), {
			attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL, name: "pixel.png" }],
			mentions: [],
		});
		const refused = await live.control.prompt(input);
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		await t.driver.quiesce();
		expect(t.router.requests(live.ref.sessionId)).toEqual([]);
		expect(countOf(live, "run_started")).toBe(0);
		expect(userMessages(live)).toEqual([]);

		expect((await live.control.setModel(wireIdOf(FAUX_MODEL_IDS.reasoner))).status).toBe("accepted");
		await t.rig.arrange(live.ref, { kind: "reply" });
		const accepted = await live.control.prompt(input);
		expect(accepted).toEqual({ status: "accepted", disposition: "started" });
		await live.waitFor("run_finished");
		expect((await t.driver.delivered(live.ref))?.attachments).toEqual(input.attachments);
	});

	test("text alone runs on the same model", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.blind) });
		await t.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("No picture.")).outcome.kind).toBe("completed");
	});
});

describe("commands and text that looks like one", () => {
	async function commandId(rig: LiveRig, id: string): Promise<string> {
		const listed = await rig.backend.listCommands({ cwd: rig.cwd });
		if (listed.status === "rejected") throw new Error(listed.rejection.message);
		const found = listed.commands.find((command) => command.id === id);
		if (!found) throw new Error(`command ${id} is not listed: ${listed.commands.map((command) => command.id)}`);
		return found.id;
	}

	test("an extension command runs at once, even mid-run, without touching the run", async () => {
		t = await LiveRig.create();
		const command = await commandId(t, "ext:drv-ping");
		const live = await holdingRun(t);
		const runId = live.reduced().run?.runId;
		const mark = live.recorder.items.length;
		const result = await live.control.prompt(
			promptInput("args here", "start", crypto.randomUUID(), { attachments: [], mentions: [], command }),
		);
		expect(result).toEqual({ status: "accepted", disposition: "handled" });
		await t.bus.commandsRan(1);
		expect(t.bus.commandRuns).toEqual(["args here"]);
		expect(live.reduced().run?.runId).toBe(runId);
		const since = live
			.events()
			.slice(mark)
			.map((event) => event.type);
		expect(
			since.filter((type) => ["run_started", "user_message", "queue_changed", "run_finished"].includes(type)),
		).toEqual([]);
		t.bus.release(live.ref.sessionId);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
	});

	test("typed text that starts with a slash goes to the model as text; no command and no compaction runs", async () => {
		t = await LiveRig.create();
		await commandId(t, "ext:drv-ping");
		const live = await t.rig.openNew();
		for (const typed of ["/drv-ping typed", "/compact", "/drv-template typed"]) {
			await t.rig.arrange(live.ref, { kind: "reply" });
			const { outcome } = await live.run(typed);
			expect(outcome.kind).toBe("completed");
			expect(await t.driver.delivered(live.ref)).toEqual({ text: typed, attachments: [], mentions: [] });
		}
		await t.driver.quiesce();
		expect(t.bus.commandRuns).toEqual([]);
		expect(live.events().some((event) => event.type === "compaction_started")).toBe(false);
	});

	test("a command the session does not have is not_found, and nothing starts", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		for (const command of ["ext:no-such-command", "prompt:no-such-template"]) {
			const result = await live.control.prompt(
				promptInput("now", "start", crypto.randomUUID(), { attachments: [], mentions: [], command }),
			);
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		}
		await t.driver.quiesce();
		expect(countOf(live, "run_started")).toBe(0);
		expect(userMessages(live)).toEqual([]);
		expect(t.router.requests(live.ref.sessionId)).toEqual([]);
	});
});

describe("what Pi would take but no human sent", () => {
	test("a prompt with no text, no image and no command is refused, and nothing reaches the model", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		for (const text of ["", "  \n\t "]) {
			const result = await live.control.prompt(promptInput(text, "start", crypto.randomUUID()));
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		}
		await t.driver.quiesce();
		expect(countOf(live, "run_started")).toBe(0);
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(0);
	});
});
