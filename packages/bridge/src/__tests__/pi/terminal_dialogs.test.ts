/**
 * What a terminal's `pi` asks reaches the phone through its link extension, and the first answer wins: the phone's goes
 * to the extension that asked and closes the terminal's dialog; the terminal's own withdraws the phone's ask.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { TerminalFeed } from "../../backends/pi/terminal/feed";
import type { Interaction, InteractionReply } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { askHuman, say } from "./helpers/scenarios";
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

interface Watched {
	readonly t: LiveRig;
	readonly terminals: TerminalRig;
	readonly terminal: Terminal;
	readonly live: LiveSession;
	readonly id: string;
}

/** A terminal session whose dialogs wait for their person, with one finished exchange, and the phone looking at it. */
async function watched(): Promise<Watched> {
	t = await LiveRig.create({ link: true });
	terminals = new TerminalRig(t);
	const terminal = await terminals.open(undefined, { dialogs: "waiting" });
	const id = terminal.session.sessionManager.getSessionId();
	await terminals.connected(terminal.file);
	t.router.script(id, [say("pong")]);
	await terminal.session.prompt("ping");
	const live = await t.rig.open({ backend: "pi", sessionId: id });
	return { t, terminals, terminal, live, id };
}

function optionValue(interaction: Interaction, label: string): string {
	const request = interaction.request;
	const option = request.kind === "choice" ? request.options.find((candidate) => candidate.label === label) : undefined;
	if (!option) throw new Error(`no option ${label} in a ${request.kind}`);
	return option.value;
}

describe("a dialog in the terminal", () => {
	test("shows on the phone; the phone's answer reaches the extension and closes the terminal's dialog", async () => {
		const { t, terminals, terminal, live, id } = await watched();
		t.router.script(id, [askHuman("select", "Pick one", { options: ["retry", "edit"], tag: "pick" }), say("Thanks.")]);
		const running = terminal.session.prompt("Ask me.");
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction).toMatchObject({ title: "Pick one", blocksRun: true, request: { kind: "choice" } });
		expect(terminals.shown.map((dialog) => dialog.title)).toEqual(["Pick one"]);

		const reply = { kind: "choice", value: optionValue(interaction, "edit") } as const;
		expect((await live.control.answer({ interactionId: interaction.id, reply })).status).toBe("accepted");
		expect((await t.router.answered("pick")).answer).toBe("edit");
		await running;
		expect(terminals.shown[0]?.closed).toBe(true);
		const notices = live.recorder.items.flatMap((item) => (item.event.type === "notice" ? [item.event.text] : []));
		expect(notices.filter((text) => text.includes("waiting for an answer"))).toEqual([]);
	});

	test("answered in the terminal first is withdrawn from the phone, and a late phone answer is stale", async () => {
		const { t, terminals, terminal, live, id } = await watched();
		t.router.script(id, [askHuman("confirm", "Proceed?", { tag: "go" }), say("Thanks.")]);
		const running = terminal.session.prompt("Ask me.");
		const { interaction } = await live.waitFor("interaction_requested");
		terminals.shown[0]?.answer(true);
		expect(await live.waitFor("interaction_resolved")).toMatchObject({
			interactionId: interaction.id,
			reason: "withdrawn",
		});
		expect((await t.router.answered("go")).answer).toBe(true);
		const late = await live.control.answer({
			interactionId: interaction.id,
			reply: { kind: "confirm", confirmed: false },
		});
		expect(late.status === "rejected" && late.rejection.code).toBe("stale");
		await running;
	});

	test("questions an extension asks on broski:questions are one questions card, answered from the phone", async () => {
		const { t, terminal, live, id } = await watched();
		t.router.script(id, [
			askHuman("questions", "Which store?", { options: ["SQLite", "Redis"], tag: "store" }),
			say("Thanks."),
		]);
		const running = terminal.session.prompt("Ask me.");
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction.request).toMatchObject({
			kind: "questions",
			questions: [{ text: "Which store?", options: [{ label: "SQLite" }, { label: "Redis" }], allowCustom: true }],
		});
		const reply: InteractionReply = {
			kind: "questions",
			answers: [{ questionId: "0", selected: [], custom: "Postgres" }],
		};
		expect((await live.control.answer({ interactionId: interaction.id, reply })).status).toBe("accepted");
		expect(JSON.parse(String((await t.router.answered("store")).answer))).toEqual([
			{ selected: [], custom: "Postgres" },
		]);
		await running;
	});

	test("a non-blocking custom overlay (such as a background bash viewer) raises no notice or ask on the phone", async () => {
		const { terminal, live } = await watched();
		const mark = live.recorder.items.length;
		const ui = terminal.session.extensionRunner.getUIContext();
		await ui.custom(() => ({ render: () => [], invalidate: () => {} }), { overlay: true });
		await Bun.sleep(50);
		const after = live.events().slice(mark);
		expect(after.filter((event) => event.type === "notice" || event.type === "interaction_requested")).toEqual([]);
		await live.close();
	});

	test("a blocking custom prompt reports its message when unmirrored, and stays quiet when mirrored via broski:questions", async () => {
		const { t, terminal, live, id } = await watched();
		const ui = terminal.session.extensionRunner.getUIContext();
		const mark = live.recorder.items.length;
		await ui.custom(() => ({ render: () => [], invalidate: () => {} }), {
			overlay: true,
			blocked: { kind: "question", message: "Approve deploy?" },
		});
		const notice = await live.waitFor("notice", () => true, mark);
		expect(notice.text).toBe("The terminal is waiting for an answer: Approve deploy?");

		const duringMirrored = live.recorder.items.length;
		t.router.script(id, [
			askHuman("questions", "Which store?", { options: ["SQLite", "Redis"], tag: "custom-mirrored" }),
			say("Done."),
		]);
		const running = terminal.session.prompt("Ask me.");
		const { interaction } = await live.waitFor("interaction_requested", () => true, duringMirrored);
		await ui.custom(() => ({ render: () => [], invalidate: () => {} }), {
			blocked: { kind: "question", message: "Which store?" },
		});
		await live.control.answer({
			interactionId: interaction.id,
			reply: { kind: "questions", answers: [{ questionId: "0", selected: ["SQLite"] }] },
		});
		await running;
		const extraNotices = live
			.events()
			.slice(duringMirrored)
			.filter((event) => event.type === "notice");
		expect(extraNotices).toEqual([]);
		await live.close();
	});

	test("an editor dialog reports a notice naming its title", async () => {
		const { terminal, live } = await watched();
		const ui = terminal.session.extensionRunner.getUIContext();
		const mark = live.recorder.items.length;
		await ui.editor("Edit commit message", "draft");
		const notice = await live.waitFor("notice", () => true, mark);
		expect(notice.text).toBe("The terminal is waiting for an answer: Edit commit message");
		await live.close();
	});

	test("a legacy titleless ui_prompt frame from an older extension raises no fake notice", () => {
		const feed = new TerminalFeed(Date.now, () => {});
		const events: unknown[] = [];
		feed.live.attach({ emit: (record) => events.push(record.event) });
		feed.event({ e: "ui_prompt", phase: "start" });
		feed.event({ e: "ui_prompt", phase: "end" });
		expect(events).toEqual([]);
	});
});
