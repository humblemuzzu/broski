/**
 * The bridge's note on writing for the phone, on the real `pi`: it reaches the model's system prompt through the
 * bridge's extension, after the user's own `APPEND_SYSTEM.md`, which it leaves in place. A session's system prompt never
 * changes once it has one, so the provider keeps its cached conversation: a phone's fork of a session begun in a
 * terminal gets the note as a hidden message, and one begun on the phone keeps it when a terminal goes on with it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE_WRITING } from "../../server/phone-writing";
import type { ScriptedRequest } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { textOf } from "./helpers/pi-router";
import { say } from "./helpers/scenarios";
import { TerminalRig } from "./helpers/terminal-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

const NOTE_TITLE = "# Writing for the phone";

let t: LiveRig | undefined;
let terminals: TerminalRig | undefined;

afterEach(async () => {
	await terminals?.quit();
	await t?.dispose();
	t = undefined;
	terminals = undefined;
});

async function systemPromptOf(rig: LiveRig): Promise<string> {
	const live = await rig.rig.openNew();
	await rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("Hello.");
	const request = rig.router.requests(live.ref.sessionId)[0];
	const system = request?.messages.filter((message) => message.role === "system" || message.role === "developer");
	return (system ?? []).map((message) => JSON.stringify(message.content)).join("\n");
}

function systemOf(request: ScriptedRequest | undefined): string {
	const system = request?.messages.filter((message) => message.role === "system" || message.role === "developer");
	return (system ?? []).map((message) => textOf(message.content)).join("\n");
}

/** How many of the request's conversation messages carry the note. */
function notesIn(request: ScriptedRequest | undefined): number {
	const conversation = request?.messages.filter((message) => message.role !== "system" && message.role !== "developer");
	return (conversation ?? []).filter((message) => textOf(message.content).includes(NOTE_TITLE)).length;
}

describe("the note on writing for the phone", () => {
	test("is the last part of a hosted pi's system prompt, after the user's own APPEND_SYSTEM.md", async () => {
		t = await LiveRig.create({ appendSystemPrompt: PHONE_WRITING });
		writeFileSync(join(t.world.env.agentDir, "APPEND_SYSTEM.md"), "The user's own closing words.");
		const system = await systemPromptOf(t);
		const own = system.indexOf("The user's own closing words.");
		const note = system.indexOf(NOTE_TITLE);
		expect(own).toBeGreaterThan(-1);
		expect(note).toBeGreaterThan(own);
		expect(system).toContain("<broski_phone>");
	});

	test("is left out when the bridge has none", async () => {
		t = await LiveRig.create();
		expect(await systemPromptOf(t)).not.toContain("Writing for the phone");
	});

	test("reaches the phone's fork of a terminal's session once, as a hidden message, and leaves its system prompt as it was", async () => {
		t = await LiveRig.create({ appendSystemPrompt: PHONE_WRITING });
		terminals = new TerminalRig(t);
		const terminal = await terminals.open();
		const id = terminal.session.sessionManager.getSessionId();
		t.router.script(id, [say("pong")]);
		await terminal.session.prompt("ping");
		await terminals.quit();

		const forked = await t.backend.fork?.({ backend: "pi", sessionId: id }, undefined);
		if (forked?.status !== "accepted") throw new Error("the fork was refused");
		const live = await t.rig.open(forked.session);
		const fork = forked.session.sessionId;
		t.router.script(fork, [say("first"), say("second")]);
		await live.run("from the phone");
		await live.run("again from the phone");
		const [desk] = t.router.requests(id);
		const [phone, again] = t.router.requests(fork);
		expect(systemOf(desk)).not.toContain(NOTE_TITLE);
		expect(systemOf(phone)).toBe(systemOf(desk));
		expect(systemOf(again)).toBe(systemOf(desk));
		expect(notesIn(desk)).toBe(0);
		expect(notesIn(phone)).toBe(1);
		expect(notesIn(again)).toBe(1);
		expect(JSON.stringify(live.events())).not.toContain(NOTE_TITLE);
		await live.close();
	});

	test("stays in the system prompt of a session begun on the phone when a terminal goes on with it", async () => {
		t = await LiveRig.create({ link: true, appendSystemPrompt: PHONE_WRITING });
		terminals = new TerminalRig(t);
		const hosted = await t.rig.openNew({});
		const id = hosted.ref.sessionId;
		t.router.script(id, [say("hosted reply")]);
		await hosted.run("from the phone");
		await t.driver.quiesce();

		const file = t.fileOf(hosted.ref);
		const sinceTerminal = hosted.recorder.items.length;
		const opened = await terminals.open(file);
		await terminals.connected(file);
		await hosted.waitFor("session_replaced", () => true, sinceTerminal);
		t.router.script(id, [say("terminal reply")]);
		await opened.session.prompt("from the terminal");
		const [phone, desk] = t.router.requests(id);
		expect(systemOf(phone)).toContain(NOTE_TITLE);
		expect(systemOf(desk)).toBe(systemOf(phone));
		expect(notesIn(desk)).toBe(0);
		await hosted.close();
	});
});
