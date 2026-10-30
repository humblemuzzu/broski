/**
 * A session a terminal `pi` runs, followed live by the phone through the Broski link: the real extension, installed by
 * the bridge and loaded by Pi's own loader into a real Pi session, talking over the real socket to the real adapter.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { type AgentEvent, sessionCapabilities } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { holdAt, say, toolUse } from "./helpers/scenarios";
import { type Terminal, TerminalRig } from "./helpers/terminal-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;
let terminals: TerminalRig | undefined;

afterEach(async () => {
	await terminals?.quit();
	await t?.dispose();
	t = undefined;
	terminals = undefined;
});

/** A terminal session with one finished exchange, so its file exists, and the phone looking at it. */
async function watched(): Promise<{
	t: LiveRig;
	terminals: TerminalRig;
	terminal: Terminal;
	live: LiveSession;
	id: string;
}> {
	t = await LiveRig.create({ link: true });
	terminals = new TerminalRig(t);
	const terminal = await terminals.open();
	const id = terminal.session.sessionManager.getSessionId();
	await terminals.connected(terminal.file);
	t.router.script(id, [say("pong")]);
	await terminal.session.prompt("ping");
	const live = await t.rig.open({ backend: "pi", sessionId: id });
	return { t, terminals, terminal, live, id };
}

function texts(events: readonly AgentEvent[], type: "user_message"): string[] {
	return events.flatMap((event) => (event.type === type ? [event.text] : []));
}

describe("a session a terminal runs", () => {
	test("streams to the phone while it runs: run, thinking, text, tool, end", async () => {
		const { t, terminal, live, id } = await watched();
		expect(sessionCapabilities(live.session)).toEqual({ controllable: true, compact: false, cancelQueued: false });
		const mark = live.recorder.items.length;
		t.router.script(id, [
			toolUse(fauxThinking("Considering."), fauxText("Reading it."), fauxToolCall("read", { path: "README.md" })),
			say("Done reading."),
		]);
		await terminal.session.prompt("read the readme");
		await live.waitFor("run_finished", () => true, mark);

		const events = live.events().slice(mark);
		expect(events.find((event) => event.type === "run_started")).toMatchObject({ trigger: "external" });
		expect(events.some((event) => event.type === "block_delta")).toBe(true);
		expect(events.some((event) => event.type === "tool_started")).toBe(true);
		expect(events.some((event) => event.type === "tool_finished")).toBe(true);
		expect(events.find((event) => event.type === "run_finished")).toMatchObject({ outcome: { kind: "completed" } });
		expect(texts(events, "user_message")).toEqual(["read the readme"]);
		live.assertSettled();
		await live.close();
	});

	test("a phone that attaches mid-run is given the run so far: its finished text, the tool under way", async () => {
		const { t, terminal, id } = await watched();
		t.router.script(id, [holdAt(t.bus.newGate(id), fauxText("Working.")), say("Done.")]);
		const running = terminal.session.prompt("keep going");
		await t.bus.entered(id);

		const live = await t.rig.open({ backend: "pi", sessionId: id });
		expect(live.initial.run?.trigger).toBe("external");
		expect(live.initial.tools.map((tool) => tool.name)).toEqual(["driver_hold"]);
		expect(live.initial.run?.items.some((item) => item.kind === "block" && item.text === "Working.")).toBe(true);

		const mark = live.recorder.items.length;
		t.bus.release(id);
		await running;
		await live.waitFor("run_finished", () => true, mark);
		live.assertSettled();
		await live.close();
	});

	test("a message from the phone starts a run in the terminal, echoed with its id; Stop is the terminal's Esc", async () => {
		const { t, terminals, terminal, live, id } = await watched();
		const mark = live.recorder.items.length;
		t.router.script(id, [holdAt(t.bus.newGate(id), fauxText("Working.")), say("Done.")]);
		const clientRequestId = "11111111-1111-4111-8111-111111111111";
		expect(await live.prompt("do it", "start", clientRequestId)).toEqual({
			status: "accepted",
			disposition: "started",
		});
		await t.bus.entered(id);

		const started = await live.waitFor("run_started", () => true, mark);
		expect(started.trigger).toBe("prompt");
		const echoed = await live.waitFor("user_message", (event) => event.text === "do it", mark);
		expect(echoed.clientRequestId).toBe(clientRequestId);

		expect(await live.prompt("not now", "start")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(await live.prompt("steer it", "steer")).toEqual({ status: "accepted", disposition: "steered" });
		expect(await live.prompt("later", "queue")).toEqual({ status: "accepted", disposition: "queued" });
		expect(terminal.session.getSteeringMessages()).toEqual(["steer it"]);
		expect(terminal.session.getFollowUpMessages()).toEqual(["later"]);

		expect((await live.control.abort()).status).toBe("accepted");
		const ended = await live.waitFor("run_finished", () => true, mark);
		expect(ended.outcome.kind).toBe("aborted");
		expect(terminals.restored).toEqual(["steer it", "later"]);
		expect(terminal.session.pendingMessageCount).toBe(0);
		expect(
			live
				.events()
				.slice(mark)
				.some((event) => event.type === "input_returned"),
		).toBe(false);
		live.assertSettled();
		await live.close();
	});

	test("a repeated prompt id is answered once, and the terminal runs it once", async () => {
		const { t, live, id } = await watched();
		const mark = live.recorder.items.length;
		t.router.script(id, [say("once")]);
		const first = await live.prompt("only once", "start", "22222222-2222-4222-8222-222222222222");
		const again = await live.prompt("only once", "start", "22222222-2222-4222-8222-222222222222");
		expect(again).toEqual(first);
		await live.waitFor("run_finished", () => true, mark);
		expect(texts(live.events().slice(mark), "user_message")).toEqual(["only once"]);
		await live.close();
	});

	test("Stop with no run is accepted and silent", async () => {
		const { live } = await watched();
		const mark = live.recorder.items.length;
		expect((await live.control.abort()).status).toBe("accepted");
		expect(live.events().slice(mark)).toEqual([]);
		await live.close();
	});

	test("when the terminal quits the session goes back to being watched, and the viewers are told", async () => {
		const { terminals, terminal, live } = await watched();
		const mark = live.recorder.items.length;
		await terminals.quit();
		await terminals.gone(terminal.file);
		const replaced = await live.waitFor("session_replaced", () => true, mark);
		expect(replaced.session).toEqual(live.ref);
		expect(sessionCapabilities(live.session)).toEqual({ controllable: false, compact: false, cancelQueued: false });
		expect(live.session.control).toBeUndefined();
		await live.close();
	});

	test("a terminal that quits mid-run ends the run on the phone", async () => {
		const { t, terminals, terminal, live, id } = await watched();
		t.router.script(id, [holdAt(t.bus.newGate(id), fauxText("Working.")), say("Done.")]);
		const mark = live.recorder.items.length;
		void terminal.session.prompt("keep going");
		await t.bus.entered(id);
		await live.waitFor("tool_started", () => true, mark);

		await terminals.quit();
		const ended = await live.waitFor("run_finished", () => true, mark);
		expect(ended.outcome.kind).toBe("aborted");
		expect(
			live
				.events()
				.slice(mark)
				.some((event) => event.type === "notice" && event.text.includes("terminal closed")),
		).toBe(true);
		await live.close();
	});

	test("a terminal that connects while the phone looks at the session makes it live, and the viewers are told", async () => {
		t = await LiveRig.create({ link: true });
		terminals = new TerminalRig(t);
		const first = await terminals.open();
		const id = first.session.sessionManager.getSessionId();
		await terminals.connected(first.file);
		t.router.script(id, [say("pong")]);
		await first.session.prompt("ping");
		await terminals.quit();
		await terminals.gone(first.file);

		const live = await t.rig.open({ backend: "pi", sessionId: id });
		expect(live.session.control).toBeUndefined();
		const mark = live.recorder.items.length;
		const again = await terminals.open(first.file);
		await terminals.connected(first.file);
		await live.waitFor("session_replaced", () => true, mark);
		expect(sessionCapabilities(live.session).controllable).toBe(true);
		t.router.script(id, [say("again")]);
		await again.session.prompt("once more");
		await live.waitFor("run_finished", () => true, mark);
		await live.close();
	});

	test("a session never hosted while a terminal holds it: opening it afterwards is the terminal's", async () => {
		t = await LiveRig.create({ link: true });
		terminals = new TerminalRig(t);
		const terminal = await terminals.open();
		const id = terminal.session.sessionManager.getSessionId();
		await terminals.connected(terminal.file);
		t.router.script(id, [say("pong")]);
		await terminal.session.prompt("ping");
		const sessionStarts = t.bus.starts(id);

		const live = await t.rig.open({ backend: "pi", sessionId: id });
		expect(t.bus.starts(id)).toBe(sessionStarts);
		expect(sessionCapabilities(live.session)).toEqual({ controllable: true, compact: false, cancelQueued: false });
		await live.close();
	});

	test("a terminal that starts a new session leaves the old one watch-only and is followed in the new one", async () => {
		const { t, terminals, terminal, live, id } = await watched();
		const mark = live.recorder.items.length;
		await terminal.runtime.newSession();
		const fresh = terminal.runtime.session;
		const freshFile = fresh.sessionManager.getSessionFile() ?? "";
		const freshId = fresh.sessionManager.getSessionId();
		expect(freshId).not.toBe(id);

		await terminals.gone(terminal.file);
		await live.waitFor("session_replaced", () => true, mark);
		await terminals.connected(freshFile);
		t.router.script(freshId, [say("in the new one")]);
		await fresh.prompt("hello there");
		const next = await t.rig.open({ backend: "pi", sessionId: freshId });
		expect(sessionCapabilities(next.session).controllable).toBe(true);
		const nextMark = next.recorder.items.length;
		t.router.script(freshId, [say("and again")]);
		await fresh.prompt("once more");
		await next.waitFor("run_finished", () => true, nextMark);
		expect(texts(next.events().slice(nextMark), "user_message")).toEqual(["once more"]);
		await next.close();
		await live.close();
	});

	test("a phone that asks to take the session over while a terminal holds it is refused, and the terminal goes on", async () => {
		const { t, live, id, terminal } = await watched();
		const refused = await t.backend.call?.({ backend: "pi", op: { kind: "take_over", sessionId: id } });
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		t.router.script(id, [say("still the terminal's")]);
		const mark = live.recorder.items.length;
		await terminal.session.prompt("carry on");
		await live.waitFor("run_finished", () => true, mark);
		await live.close();
	});

	test("a session the phone left idle gives way to a terminal that opens it", async () => {
		t = await LiveRig.create({ link: true });
		terminals = new TerminalRig(t);
		const hosted = await t.rig.openNew({});
		t.router.script(hosted.ref.sessionId, [say("hosted reply")]);
		const mark = hosted.recorder.items.length;
		await hosted.prompt("from the phone");
		await hosted.waitFor("run_finished", () => true, mark);
		await t.driver.quiesce();
		expect(hosted.session.control).toBeDefined();

		const file = t.fileOf(hosted.ref);
		const sinceTerminal = hosted.recorder.items.length;
		const opened = await terminals.open(file);
		await terminals.connected(file);
		await hosted.waitFor("session_replaced", () => true, sinceTerminal);
		t.router.script(hosted.ref.sessionId, [say("terminal reply")]);
		await opened.session.prompt("from the terminal");
		const replaced = await t.rig.open({ backend: "pi", sessionId: hosted.ref.sessionId });
		expect(sessionCapabilities(replaced.session)).toEqual({ controllable: true, compact: false, cancelQueued: false });
		expect(texts(replaced.events(), "user_message")).toEqual([]);
		await replaced.close();
		await hosted.close();
	});

	test("a compaction in the terminal shows on the phone as one, and ends", async () => {
		const { t, terminal, live, id } = await watched();
		const mark = live.recorder.items.length;
		t.router.script(id, [say("A summary of the exchange.")]);
		await terminal.session.compact();
		await live.waitFor("compaction_finished", () => true, mark);
		const events = live.events().slice(mark);
		expect(events.findIndex((event) => event.type === "compaction_started")).toBeLessThan(
			events.findIndex((event) => event.type === "compaction_finished"),
		);
		expect(live.reduced().compaction).toBeUndefined();
		live.assertSettled();
		await live.close();
	});

	test("a thinking level chosen in the terminal reaches the phone", async () => {
		const { terminal, live } = await watched();
		const mark = live.recorder.items.length;
		terminal.session.setThinkingLevel("high");
		await live.waitFor("model_changed", (event) => event.thinking === "high", mark);
		await live.close();
	});

	test("a name given in the terminal reaches the session list", async () => {
		const { t, terminal, live, id } = await watched();
		terminal.session.setSessionName("Named in the terminal");
		await t.catalog.waitFor(
			(items) =>
				items.find(
					(event) =>
						event.type === "session_updated" &&
						event.summary.session.sessionId === id &&
						event.summary.title?.text === "Named in the terminal",
				),
			"the new name in the list",
		);
		await live.close();
	});
});
