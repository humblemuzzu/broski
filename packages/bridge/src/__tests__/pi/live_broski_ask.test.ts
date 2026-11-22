/**
 * On the real adapter and the real `pi`: the bridge's own extension gives the model `broski_ask`, so a Pi with no
 * questions extension of the user's asks on the phone. The run waits on one questions card, never behind a permission
 * ask, and the model reads the person's answer, or that they dismissed it. A session that ran without the tool, as one
 * begun in a terminal did, goes on without it, so its tools and its prompt cache stay as they were. A Pi whose own
 * extensions give an ask tool gets no second one, and the terminal link installed beside it changes nothing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extensionEntry } from "../../backends/pi/terminal/install";
import { raisedAs } from "../../backends/pi/ui/dialog-asks";
import type { Interaction, InteractionReply } from "../../contract";
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

/** A session whose run calls `broski_ask`, then ends with the tool result the model was sent. */
async function asking(rig: LiveRig, modes: { axis: string; value: string }[] = []) {
	const live = await rig.rig.openNew({ modes });
	const seen = Promise.withResolvers<string>();
	const afterAnswer = (request: ScriptedRequest) => {
		const results = request.messages.filter((message) => message.role === "tool");
		seen.resolve(textOf(results.at(-1)?.content));
		return say("Thanks.");
	};
	rig.router.script(live.ref.sessionId, [call("broski_ask", ASKED), afterAnswer]);
	await live.prompt("Ask me where to store things.");
	const { interaction } = await live.waitFor("interaction_requested");
	return { live, interaction, toolResult: seen.promise };
}

function answer(live: LiveSession, interaction: Interaction, reply: InteractionReply) {
	return live.control.answer({ interactionId: interaction.id, reply });
}

/** A user's own questions extension, found where Pi looks for the user's extensions. */
function installUserAsk(agentDir: string): void {
	const folder = join(agentDir, "extensions");
	mkdirSync(folder, { recursive: true });
	const tool = (name: string) =>
		`pi.registerTool({ name: "${name}", label: "${name}", description: "Asks the user.", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "asked" }], details: {} }) });`;
	writeFileSync(
		join(folder, "user-ask.ts"),
		`export default function (pi) {\n${tool("ask")}\n${tool("ask_user")}\n}\n`,
	);
}

describe("broski_ask in a hosted pi", () => {
	test("is one questions card the run waits on, and the model reads the answers", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t);
		expect(interaction).toMatchObject({
			title: "Storage",
			blocksRun: true,
			runId: live.reduced().run?.runId,
			request: {
				kind: "questions",
				questions: [
					{ id: "0", header: "Store", text: "Which store?", options: [{ label: "SQLite" }, { label: "Redis" }] },
					{ id: "1", text: "Anything else?", options: [], allowCustom: true },
				],
			},
		});
		expect(live.reduced().run).toBeDefined();

		const reply: InteractionReply = {
			kind: "questions",
			answers: [
				{ questionId: "0", selected: ["Redis"] },
				{ questionId: "1", selected: [], custom: "Keep it local." },
			],
		};
		expect((await answer(live, interaction, reply)).status).toBe("accepted");
		expect(JSON.parse(await toolResult)).toEqual({
			status: "answered",
			answers: [
				{ question: "Which store?", selected: ["Redis"] },
				{ question: "Anything else?", selected: [], custom: "Keep it local." },
			],
		});
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test("in ask mode it raises no permission ask of its own", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t, [{ axis: "permissions", value: "ask" }]);
		expect(interaction.request.kind).toBe("questions");
		await answer(live, interaction, { kind: "questions", answers: [{ questionId: "0", selected: ["SQLite"] }] });
		expect(JSON.parse(await toolResult).status).toBe("answered");
		await live.waitFor("run_finished");
		const asks = live.events().filter((event) => event.type === "interaction_requested");
		expect(asks).toHaveLength(1);
	});

	test("a dismissed card tells the model it was cancelled, and the run goes on", async () => {
		t = await LiveRig.create();
		const { live, interaction, toolResult } = await asking(t);
		await answer(live, interaction, { kind: "cancel", stopRun: false });
		expect(JSON.parse(await toolResult)).toEqual({
			status: "cancelled",
			message: "The user dismissed the questions.",
		});
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
	});
});

describe("which sessions have broski_ask", () => {
	test("one the phone starts declares it; the phone's fork of a terminal's session keeps the tools it had", async () => {
		t = await LiveRig.create();
		const hosted = await t.rig.openNew();
		t.router.script(hosted.ref.sessionId, [say("hosted")]);
		await hosted.run("from the phone");
		expect(t.router.requests(hosted.ref.sessionId)[0]?.tools).toContain("broski_ask");

		terminals = new TerminalRig(t);
		const terminal = await terminals.open();
		const id = terminal.session.sessionManager.getSessionId();
		t.router.script(id, [say("pong")]);
		await terminal.session.prompt("ping");
		await terminals.quit();
		const forked = await t.backend.fork?.({ backend: "pi", sessionId: id }, undefined);
		if (forked?.status !== "accepted") throw new Error("the fork was refused");
		const taken = await t.rig.open(forked.session);
		t.router.script(forked.session.sessionId, [say("taken over")]);
		await taken.run("from the phone");
		const [desk] = t.router.requests(id);
		const [phone] = t.router.requests(forked.session.sessionId);
		expect(desk?.tools).not.toContain("broski_ask");
		expect(phone?.tools).toEqual(desk?.tools ?? []);
		await taken.close();
	});
});

describe("beside the user's own extensions", () => {
	test("a new session of a Pi with its own ask tool declares that one and no broski_ask", async () => {
		t = await LiveRig.create();
		installUserAsk(t.world.env.agentDir);
		const hosted = await t.rig.openNew();
		t.router.script(hosted.ref.sessionId, [say("hosted")]);
		await hosted.run("from the phone");
		const tools = t.router.requests(hosted.ref.sessionId)[0]?.tools ?? [];
		expect(tools).toEqual(expect.arrayContaining(["ask", "ask_user"]));
		expect(tools).not.toContain("broski_ask");
	});

	test("with the terminal link installed, the bridge's pi starts and broski_ask asks the phone once", async () => {
		t = await LiveRig.create({ link: true });
		expect(existsSync(extensionEntry(t.world.env.agentDir))).toBe(true);
		const { live, interaction, toolResult } = await asking(t);
		const reply: InteractionReply = { kind: "questions", answers: [{ questionId: "0", selected: ["SQLite"] }] };
		expect((await answer(live, interaction, reply)).status).toBe("accepted");
		expect(JSON.parse(await toolResult)).toEqual({
			status: "answered",
			answers: [
				{ question: "Which store?", selected: ["SQLite"] },
				{ question: "Anything else?", selected: [] },
			],
		});
		await live.waitFor("run_finished");
		const tools = t.router.requests(live.ref.sessionId)[0]?.tools ?? [];
		expect(tools.filter((name) => name === "broski_ask")).toEqual(["broski_ask"]);
		expect(live.events().filter((event) => event.type === "interaction_requested")).toHaveLength(1);
	});
});

describe("a phone session's broski_ask across a new pi", () => {
	test("a session that declared it keeps it when a new pi takes the session up", async () => {
		t = await LiveRig.create({ maxHosted: 1 });
		const first = await t.rig.openNew();
		t.router.script(first.ref.sessionId, [say("one"), say("two")]);
		await first.run("first");
		await t.rig.openNew();
		await first.run("again");
		const [before, after] = t.router.requests(first.ref.sessionId);
		expect(first.events().filter((event) => event.type === "resynced")).toHaveLength(1);
		expect(before?.tools).toContain("broski_ask");
		expect(after?.tools).toEqual(before?.tools ?? []);
	});
});

describe("questions the bridge cannot read", () => {
	test("past a bound, Pi refuses the call and the model reads why; no card is raised", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const seen = Promise.withResolvers<string>();
		const tooMany = { questions: Array.from({ length: 21 }, (_, at) => ({ question: `Q${at}?` })) };
		t.router.script(live.ref.sessionId, [
			call("broski_ask", tooMany),
			(request: ScriptedRequest) => {
				seen.resolve(textOf(request.messages.filter((message) => message.role === "tool").at(-1)?.content));
				return say("Fewer, then.");
			},
		]);
		expect((await live.run("Ask me a lot.")).outcome.kind).toBe("completed");
		expect(await seen.promise).toContain("Validation failed");
		expect(live.events().filter((event) => event.type === "interaction_requested")).toEqual([]);
	});

	test("an unreadable questions dialog is no card at all, never its raw JSON as a text ask", () => {
		expect(raisedAs({ method: "input", title: "broski-questions:{not json" })).toBeUndefined();
		expect(raisedAs({ method: "input", title: 'broski-questions:{"questions":[]}' })).toBeUndefined();
		expect(raisedAs({ method: "input", title: "Your name?" })?.spec.request.kind).toBe("text");
	});
});
