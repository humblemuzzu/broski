/**
 * On the real adapter: a run goes on and persists without a viewer, shutdown loses nothing, no runtime is leaked,
 * a restart mid-run leaves the run going for the next bridge, repeating nothing, and a session another client made
 * opens watch-only.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionCapabilities } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { answerTexts, countOf, holdingRun, toolCallItems, userItems, userMessages } from "./helpers/live-steps";
import { allItems, allRows } from "./helpers/paging";
import { say } from "./helpers/scenarios";
import { conversation, messagesIn, readEntries, userTexts, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("close and shutdown during a run", () => {
	test("a run whose viewer closed goes on, finishes and is persisted, and its runtime then ends", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "keep going");
		const { sessionId } = live.ref;
		await live.close();
		expect(t.router.liveRuntimes(sessionId)).toBe(1);

		t.router.release(sessionId);
		await t.router.shutDown(sessionId);
		const items = await allItems(t.backend, live.ref, 200);
		expect(answerTexts(items)).toEqual(["Done.", "Working."]);
		expect(userTexts(t.fileOf(live.ref))).toEqual(["keep going"]);
		const reopened = await t.rig.open(live.ref);
		expect(reopened.initial.run).toBeUndefined();
		const found = await t.backend.getSession(live.ref);
		expect(found.status === "accepted" && found.summary.status).toBe("idle");
	});

	test("shutdown mid-run lets go of the run, whose holder keeps it; the next bridge stops it, and the aborted turn is kept", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "interrupt me");
		await t.backend.dispose();

		const file = t.fileOf(live.ref);
		expect(messagesIn(file).map(([role]) => role)).toEqual(["system", "user", "assistant"]);
		expect(t.router.liveRuntimes(live.ref.sessionId)).toBe(1);

		await t.rig.restart();
		const reopened = await t.rig.open(live.ref);
		const runId = reopened.initial.run?.runId;
		expect(runId).toBeDefined();
		expect((await reopened.control.abort()).status).toBe("accepted");
		const finished = await reopened.waitFor("run_finished", (event) => event.runId === runId);
		expect(finished.outcome.kind).toBe("aborted");
		expect(messagesIn(file).map(([role]) => role)).toEqual(["system", "user", "assistant", "toolResult", "assistant"]);
		const last = readEntries(file).at(-1);
		expect(last?.type === "message" && last.message.role === "assistant" && last.message.stopReason).toBe("aborted");
		const items = await allItems(t.backend, live.ref, 200);
		expect(toolCallItems(items).map((item) => item.name)).toEqual(["driver_hold"]);
		expect(userItems(items).map((item) => item.text)).toEqual(["interrupt me"]);
	});
});

describe("no runtime is leaked", () => {
	test("a session runs while another of the same directory is parked, each with its own script and runtime", async () => {
		t = await LiveRig.create();
		const parked = await holdingRun(t, {}, "parked");
		const other = await t.rig.openNew();
		t.router.script(other.ref.sessionId, [say("beta")]);
		await other.run("two");
		expect(other.reduced().run).toBeUndefined();
		expect(parked.reduced().run).toBeDefined();
		expect(t.router.starts(parked.ref.sessionId)).toBe(1);
		expect(t.router.starts(other.ref.sessionId)).toBe(1);
		const rows = await allRows(t.backend, { cwd: t.cwd }, 50);
		const status = (id: string) => rows.find((row) => row.session.sessionId === id)?.status;
		expect([status(parked.ref.sessionId), status(other.ref.sessionId)]).toEqual(["running", "idle"]);

		t.router.release(parked.ref.sessionId);
		await parked.waitFor("run_finished");
		expect(userTexts(t.fileOf(other.ref))).toEqual(["two"]);
		expect(userTexts(t.fileOf(parked.ref))).toEqual(["parked"]);
	});

	test("sessions closed and opened again in quick succession end every runtime they start", async () => {
		t = await LiveRig.create();
		const first = await t.rig.openNew();
		await t.rig.arrange(first.ref, { kind: "reply" });
		await first.run("one");
		let view = first;
		for (let again = 0; again < 5; again++) {
			await view.close();
			view = await t.rig.open(first.ref);
		}
		await t.rig.arrange(first.ref, { kind: "reply" });
		await view.run("two");
		expect(userMessages(view).map((message) => message.text)).toEqual(["two"]);
		expect(t.router.liveRuntimes(first.ref.sessionId)).toBe(1);

		await t.backend.dispose();
		expect(t.router.starts(first.ref.sessionId)).toBeGreaterThanOrEqual(1);
		expect(t.router.liveRuntimes()).toBe(0);
		expect(userTexts(t.fileOf(first.ref))).toEqual(["one", "two"]);
	});
});

describe("a restart mid-run", () => {
	test("keeps the session and its run, which finishes in the new bridge, repeating nothing", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "survive me");
		const clientRequestId = userMessages(live)[0]?.clientRequestId;
		const before = live.reduced().run?.runId;
		await t.rig.restart();

		const found = await t.backend.getSession(live.ref);
		expect(found.status === "accepted" && found.summary.status).toBe("running");
		const reopened = await t.rig.open(live.ref);
		const run = reopened.initial.run;
		expect(run?.runId).toBeDefined();
		expect(run?.runId).not.toBe(before);
		const prompt = run?.items.find((item) => item.kind === "user_message");
		expect(prompt?.kind === "user_message" && [prompt.text, prompt.clientRequestId]).toEqual([
			"survive me",
			clientRequestId,
		]);
		expect(run?.items.some((item) => item.kind === "tool_call" && item.name === "driver_hold")).toBe(true);

		t.router.release(live.ref.sessionId);
		const finished = await reopened.waitFor("run_finished", (event) => event.runId === run?.runId);
		expect(finished.outcome.kind).toBe("completed");
		expect(answerTexts(await allItems(t.backend, live.ref, 200))).toEqual(["Done.", "Working."]);
		await t.rig.arrange(live.ref, { kind: "reply" });
		expect((await reopened.run("after the restart")).outcome.kind).toBe("completed");
		expect(userTexts(t.fileOf(live.ref))).toEqual(["survive me", "after the restart"]);
		expect(countOf(reopened, "run_started")).toBe(1);
		expect(t.router.starts(live.ref.sessionId)).toBe(1);
	});

	test("a session whose directory is gone opens watch-only: it can be read, and nothing can run there", async () => {
		t = await LiveRig.create();
		const project = join(t.world.env.root, "short-lived");
		mkdirSync(project);
		const live = await t.rig.openNew({ cwd: project });
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("hello");
		await live.close();
		await t.router.shutDown(live.ref.sessionId);
		renameSync(project, `${project}-moved`);

		const opened = await t.backend.open({ kind: "existing", session: live.ref }, { emit: () => {} });
		if (opened.status === "rejected") throw new Error(opened.rejection.message);
		expect(opened.session.control).toBeUndefined();
		expect(t.router.liveRuntimes()).toBe(0);
		const read = await t.backend.readTranscript(live.ref, { limit: 10 });
		expect(read.status === "accepted" && read.page.items.some((item) => item.kind === "user_message")).toBe(true);
	});
});

describe("a session another client made", () => {
	test("opens watch-only: no control, no runtime, and the file is not touched", async () => {
		t = await LiveRig.create();
		const id = "terminal-session-1";
		const path = writeSessionFile(
			t.world.sessionsRoot,
			{ id, cwd: t.cwd, version: 3 },
			conversation(["from the terminal", "terminal answer"]),
		);
		const before = { bytes: readFileSync(path), modified: statSync(path).mtimeMs };

		const rows = await allRows(t.backend, { cwd: t.cwd }, 50);
		expect(rows.find((row) => row.session.sessionId === id)?.origin).toBe("external");
		const opened = await t.rig.open({ backend: "pi", sessionId: id });
		expect(opened.session.control).toBeUndefined();
		expect(sessionCapabilities(opened.session)).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			answer: false,
		});
		expect(opened.initial.run).toBeUndefined();
		const items = await allItems(t.backend, opened.ref, 200);
		expect(userItems(items).map((item) => item.text)).toEqual(["from the terminal"]);
		await opened.close();

		expect(t.router.starts(id)).toBe(0);
		expect(readFileSync(path).equals(before.bytes)).toBe(true);
		expect(statSync(path).mtimeMs).toBe(before.modified);
	});

	test("one Pi's own SessionManager wrote, as the app's old path writes them, is the same: watch-only, and a fork is the bridge's", async () => {
		t = await LiveRig.create();
		const manager = SessionManager.create(t.cwd, t.world.sessionsRoot);
		manager.appendMessage({ role: "user", content: "made by the old app", timestamp: Date.now() });
		manager.appendMessage(fauxAssistantMessage("its answer"));
		const ref = { backend: "pi", sessionId: manager.getSessionId() } as const;

		const found = await t.backend.getSession(ref);
		expect(found.status === "accepted" && found.summary.origin).toBe("external");
		const opened = await t.rig.open(ref);
		expect(opened.session.control).toBeUndefined();
		await opened.close();

		const forked = await t.backend.fork?.(ref, undefined);
		if (forked?.status !== "accepted") throw new Error("the fork was refused");
		const child = await t.backend.getSession(forked.session);
		expect(child.status === "accepted" && child.summary.origin).toBe("broski");
		const continued = await t.rig.open(forked.session);
		expect(continued.session.control).toBeDefined();
	});
});
