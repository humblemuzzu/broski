/**
 * `broski_ask` when a session moves from the phone to the terminal: the link extension keeps the tool in a session the
 * phone started, so its declared tools and its prompt cache stay; an ordinary terminal session never gets it. Asked in
 * the terminal, the questions show there and on the phone, and the first answer wins.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { InteractionReply } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import type { ScriptedRequest } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { textOf } from "./helpers/pi-router";
import { call, say } from "./helpers/scenarios";
import { TerminalRig } from "./helpers/terminal-rig";
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

const ASKED = {
	title: "Storage",
	questions: [
		{ question: "Which store?", header: "Store", options: [{ label: "SQLite" }, { label: "Redis" }] },
		{ question: "Anything else?" },
	],
};

const ANSWERED = {
	status: "answered",
	answers: [
		{ question: "Which store?", selected: ["Redis"] },
		{ question: "Anything else?", selected: [], custom: "Keep it local." },
	],
};

/** A session the phone started and ran once, closed on the phone. */
async function fromThePhone(rig: LiveRig): Promise<{ id: string; file: string }> {
	const hosted = await rig.rig.openNew();
	rig.router.script(hosted.ref.sessionId, [say("hosted")]);
	await hosted.run("from the phone");
	await hosted.close();
	return { id: hosted.ref.sessionId, file: rig.fileOf(hosted.ref) };
}

/** The system messages of the session file that change its declared tools. */
function toolChanges(file: string): unknown[] {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line))
		.filter((entry) => entry.type === "message" && entry.message?.role === "system")
		.filter((entry) => entry.message.toolsAdded !== undefined || entry.message.toolsRemoved !== undefined);
}

async function shown(rig: TerminalRig, count: number): Promise<void> {
	while (rig.shown.length < count) await new Promise<void>((resolve) => setImmediate(resolve));
}

interface Asking {
	readonly desk: TerminalRig;
	readonly live: LiveSession;
	readonly toolResult: Promise<string>;
	readonly running: Promise<void>;
}

/** Answers the terminal's dialog number `at` once it shows; a select's rows are given to `pick`. */
async function answerAt(desk: TerminalRig, at: number, pick: (options: readonly string[]) => unknown): Promise<void> {
	await shown(desk, at + 1);
	const dialog = desk.shown[at];
	dialog?.answer(pick(dialog.options));
}

/** The phone's session taken up in a terminal whose dialogs wait, the phone watching, and a run calling broski_ask. */
async function askingInTheTerminal(asked: Record<string, unknown> = ASKED): Promise<Asking> {
	const rig = await LiveRig.create({ link: true });
	t = rig;
	const { id, file } = await fromThePhone(rig);
	const desk = new TerminalRig(rig);
	terminals = desk;
	const terminal = await desk.open(file, { dialogs: "waiting" });
	await desk.connected(file);
	const live = await rig.rig.open({ backend: "pi", sessionId: id });
	const seen = Promise.withResolvers<string>();
	rig.router.script(id, [
		call("broski_ask", asked),
		(request: ScriptedRequest) => {
			seen.resolve(textOf(request.messages.filter((message) => message.role === "tool").at(-1)?.content));
			return say("Thanks.");
		},
	]);
	const running = terminal.session.prompt("Ask me where to store things.");
	return { desk, live, toolResult: seen.promise, running };
}

describe("which terminal sessions have broski_ask", () => {
	test("an ordinary terminal session never declares it, begun or resumed", async () => {
		t = await LiveRig.create({ link: true });
		terminals = new TerminalRig(t);
		const terminal = await terminals.open();
		const id = terminal.session.sessionManager.getSessionId();
		t.router.script(id, [say("one"), say("two")]);
		await terminal.session.prompt("first");
		await terminals.quit();
		const resumed = await terminals.open(terminal.file);
		expect(resumed.session.getActiveToolNames()).not.toContain("broski_ask");
		await resumed.session.prompt("again");
		const [begun, again] = t.router.requests(id);
		expect(begun?.tools).not.toContain("broski_ask");
		expect(again?.tools).toEqual(begun?.tools ?? []);
	});

	test("a session the phone started keeps it in the terminal, and declares no tool change", async () => {
		t = await LiveRig.create({ link: true });
		const { id, file } = await fromThePhone(t);
		terminals = new TerminalRig(t);
		const terminal = await terminals.open(file);
		t.router.script(id, [say("at the desk")]);
		await terminal.session.prompt("from the terminal");
		const [phone, desk] = t.router.requests(id);
		expect(phone?.tools).toContain("broski_ask");
		expect(desk?.tools).toEqual(phone?.tools ?? []);
		expect(toolChanges(file)).toHaveLength(1);
	});

	test("moved in the tree to before the phone's first run, the terminal drops it; moved back, it has it again", async () => {
		t = await LiveRig.create({ link: true });
		const { file } = await fromThePhone(t);
		terminals = new TerminalRig(t);
		const { session } = await terminals.open(file);
		const leaf = session.sessionManager.getLeafId();
		const entries = session.sessionManager.getEntries();
		const declared = entries.find((entry) => entry.type === "message" && entry.message.role === "system");
		if (!leaf || !declared?.parentId) throw new Error("the phone's session records nothing before its first run");
		await session.navigateTree(declared.parentId);
		expect(session.getActiveToolNames()).not.toContain("broski_ask");
		await session.navigateTree(leaf);
		expect(session.getActiveToolNames()).toContain("broski_ask");
	});
});

describe("broski_ask asked in the terminal", () => {
	test("the phone's answer wins: the terminal's question closes and the model reads the phone's answers", async () => {
		const { desk, live, toolResult, running } = await askingInTheTerminal();
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction).toMatchObject({ title: "Storage", request: { kind: "questions" } });
		await shown(desk, 1);
		expect(desk.shown[0]?.title).toBe("Store: Which store?");
		const reply: InteractionReply = {
			kind: "questions",
			answers: [
				{ questionId: "0", selected: ["Redis"] },
				{ questionId: "1", selected: [], custom: "Keep it local." },
			],
		};
		expect((await live.control.answer({ interactionId: interaction.id, reply })).status).toBe("accepted");
		expect(JSON.parse(await toolResult)).toEqual(ANSWERED);
		expect(desk.shown[0]?.closed).toBe(true);
		expect(desk.shown).toHaveLength(1);
		await running;
		expect(live.events().filter((event) => event.type === "interaction_requested")).toHaveLength(1);
	});

	test("the terminal's answer wins: the phone's card is withdrawn, and a late phone answer is stale", async () => {
		const { desk, live, toolResult, running } = await askingInTheTerminal();
		const { interaction } = await live.waitFor("interaction_requested");
		await shown(desk, 1);
		desk.shown[0]?.answer("Redis");
		await shown(desk, 2);
		expect(desk.shown[1]?.title).toBe("Anything else?");
		desk.shown[1]?.answer("Keep it local.");
		expect(await live.waitFor("interaction_resolved")).toMatchObject({
			interactionId: interaction.id,
			reason: "withdrawn",
		});
		expect(JSON.parse(await toolResult)).toEqual(ANSWERED);
		const late = await live.control.answer({
			interactionId: interaction.id,
			reply: { kind: "cancel", stopRun: false },
		});
		expect(late.status === "rejected" && late.rejection.code).toBe("stale");
		await running;
	});

	test("an option that reads like the picker's own typed-answer row is still that option, and that row still asks", async () => {
		const option = { label: "Something else…" };
		const question = (text: string) => ({ question: text, options: [option, { label: "Redis" }] });
		const { desk, toolResult, running } = await askingInTheTerminal({
			questions: [question("One?"), question("Two?")],
		});
		await answerAt(desk, 0, (rows) => rows[0]);
		await answerAt(desk, 1, (rows) => rows.at(-1));
		expect(desk.shown[1]?.options).toEqual(["Something else…", "Redis", "Something else… "]);
		await answerAt(desk, 2, () => "Postgres");
		expect(desk.shown[2]?.options).toEqual([]);
		expect(JSON.parse(await toolResult)).toEqual({
			status: "answered",
			answers: [
				{ question: "One?", selected: ["Something else…"] },
				{ question: "Two?", selected: [], custom: "Postgres" },
			],
		});
		await running;
	});

	test("a question that allows several picks one option at a time until Done", async () => {
		const options = [{ label: "SQLite" }, { label: "Redis" }, { label: "Postgres" }];
		const asked = { questions: [{ question: "Which stores?", multiple: true, options }] };
		const { desk, toolResult, running } = await askingInTheTerminal(asked);
		await answerAt(desk, 0, () => "Redis");
		await answerAt(desk, 1, () => "Postgres");
		await answerAt(desk, 2, () => "Done");
		expect(desk.shown.map((dialog) => dialog.options)).toEqual([
			["SQLite", "Redis", "Postgres", "Something else…", "Done"],
			["SQLite", "Postgres", "Something else…", "Done"],
			["SQLite", "Something else…", "Done"],
		]);
		expect(JSON.parse(await toolResult)).toEqual({
			status: "answered",
			answers: [{ question: "Which stores?", selected: ["Redis", "Postgres"] }],
		});
		await running;
	});
});
