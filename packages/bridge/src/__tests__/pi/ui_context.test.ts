/**
 * The remote `ExtensionUIContext` (D13): each dialog becomes the interaction kind Pi's RPC mode
 * maps it to, answered with Pi's value, defaulted when nobody answers; the rest does nothing.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createRemoteUiContext } from "../../backends/pi/ui/ui-context";
import { type InteractionReply, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../contract";
import { deskRig, pause } from "./desk_rig";

function uiRig() {
	const rig = deskRig();
	const ui = createRemoteUiContext(rig.desk, rig.live);
	async function answerNext(reply: InteractionReply) {
		const { interaction } = await rig.log.next("interaction_requested");
		const result = rig.desk.answer({ interactionId: interaction.id, reply });
		return { interaction, result };
	}
	return { ...rig, ui, answerNext };
}

describe("select", () => {
	test("is a choice whose values are positions; the answer is the extension's own string", async () => {
		const { ui, answerNext, log } = uiRig();
		const picked = ui.select("Pick one", ["alpha", "beta", "alpha"]);
		const { interaction } = await answerNext({ kind: "choice", value: "1" });
		expect(interaction.title).toBe("Pick one");
		expect(interaction.request).toEqual({
			kind: "choice",
			options: [
				{ value: "0", label: "alpha" },
				{ value: "1", label: "beta" },
				{ value: "2", label: "alpha" },
			],
		});
		expect(await picked).toBe("beta");
		expect(log.of("interaction_resolved")[0]?.reason).toBe("answered");
	});

	test("cancelled gives Pi's default, undefined", async () => {
		const { ui, answerNext } = uiRig();
		const picked = ui.select("Pick", ["a"]);
		await answerNext({ kind: "cancel", stopRun: false });
		expect(await picked).toBeUndefined();
	});

	test("with no options it is undefined at once and asks nobody", async () => {
		const { ui, log } = uiRig();
		expect(await ui.select("Pick", [])).toBeUndefined();
		expect(log.events).toEqual([]);
	});

	test("offers the first MAX_LIST_ITEMS options", async () => {
		const { ui, answerNext } = uiRig();
		const options = Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, index) => `option ${index}`);
		const picked = ui.select("Pick", options);
		const { interaction } = await answerNext({ kind: "choice", value: String(MAX_LIST_ITEMS - 1) });
		expect(interaction.request.kind === "choice" && interaction.request.options).toHaveLength(MAX_LIST_ITEMS);
		expect(await picked).toBe(`option ${MAX_LIST_ITEMS - 1}`);
	});

	test("the extension's timeout becomes expiresAt and ends the dialog as undefined", async () => {
		const { ui, log } = uiRig();
		const picked = ui.select("Pick", ["a"], { timeout: 25 });
		const { interaction } = await log.next("interaction_requested");
		expect(interaction.expiresAt).toBe(1_000_025);
		expect(await picked).toBeUndefined();
		expect(log.of("interaction_resolved")[0]?.reason).toBe("withdrawn");
	});

	test("the extension's signal withdraws it", async () => {
		const { ui, log } = uiRig();
		const controller = new AbortController();
		const picked = ui.select("Pick", ["a"], { signal: controller.signal });
		await log.next("interaction_requested");
		controller.abort();
		expect(await picked).toBeUndefined();
		expect(log.of("interaction_resolved")[0]?.reason).toBe("withdrawn");
	});
});

describe("two dialogs at once", () => {
	test("each gets the answer to its own question", async () => {
		const { ui, desk, log } = uiRig();
		const colour = ui.select("Colour?", ["red", "green"]);
		const size = ui.select("Size?", ["small", "large"]);
		const first = await log.next("interaction_requested", (event) => event.interaction.title === "Colour?");
		const second = await log.next("interaction_requested", (event) => event.interaction.title === "Size?");
		desk.answer({ interactionId: second.interaction.id, reply: { kind: "choice", value: "1" } });
		desk.answer({ interactionId: first.interaction.id, reply: { kind: "choice", value: "0" } });
		expect(await colour).toBe("red");
		expect(await size).toBe("large");
	});
});

describe("confirm", () => {
	test("is a confirm with the message as its body", async () => {
		const { ui, answerNext } = uiRig();
		const confirmed = ui.confirm("Delete?", "This cannot be undone.");
		const { interaction } = await answerNext({ kind: "confirm", confirmed: true });
		expect(interaction).toMatchObject({
			title: "Delete?",
			body: "This cannot be undone.",
			request: { kind: "confirm" },
		});
		expect(await confirmed).toBe(true);
	});

	test("an empty message leaves out the body", async () => {
		const { ui, answerNext } = uiRig();
		const confirmed = ui.confirm("Sure?", "");
		const { interaction } = await answerNext({ kind: "confirm", confirmed: false });
		expect(interaction).not.toHaveProperty("body");
		expect(await confirmed).toBe(false);
	});

	test("cancelled is false, Pi's default", async () => {
		const { ui, answerNext } = uiRig();
		const confirmed = ui.confirm("Sure?", "m");
		await answerNext({ kind: "cancel", stopRun: false });
		expect(await confirmed).toBe(false);
	});
});

describe("input and editor", () => {
	test("input is single-line text with its placeholder; a newline in the answer is refused", async () => {
		const { ui, answerNext, desk, log } = uiRig();
		const typed = ui.input("Name", "your name");
		const { interaction, result } = await answerNext({ kind: "text", text: "two\nlines" });
		expect(interaction.request).toEqual({ kind: "text", multiline: false, placeholder: "your name" });
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		desk.answer({ interactionId: interaction.id, reply: { kind: "text", text: "" } });
		expect(await typed).toBe("");
		expect(log.of("interaction_resolved")).toHaveLength(1);
	});

	test("input without a placeholder has none; cancelled is undefined", async () => {
		const { ui, answerNext } = uiRig();
		const typed = ui.input("Name");
		const { interaction } = await answerNext({ kind: "cancel", stopRun: false });
		expect(interaction.request).toEqual({ kind: "text", multiline: false });
		expect(await typed).toBeUndefined();
	});

	test("editor is multiline text prefilled, with no deadline and no signal", async () => {
		const { ui, answerNext } = uiRig();
		const edited = ui.editor("Edit", "line one\nline two");
		const { interaction } = await answerNext({ kind: "text", text: "line one\nline 2" });
		expect(interaction.request).toEqual({ kind: "text", multiline: true, initialText: "line one\nline two" });
		expect(interaction).not.toHaveProperty("expiresAt");
		expect(await edited).toBe("line one\nline 2");
	});

	test("editor cancelled is undefined, and it waits as long as the human does", async () => {
		const { ui, answerNext } = uiRig();
		const edited = ui.editor("Edit");
		let done = false;
		void edited.then(() => {
			done = true;
		});
		await pause(60);
		expect(done).toBe(false);
		const { interaction } = await answerNext({ kind: "cancel", stopRun: false });
		expect(interaction.request).toEqual({ kind: "text", multiline: true });
		expect(await edited).toBeUndefined();
	});
});

describe("text an extension styled", () => {
	test("arrives without terminal escapes and within the contract's bounds", async () => {
		const { ui, answerNext, log, desk } = uiRig();
		const accent = (text: string) => ui.theme.fg("accent", text);
		expect(accent("x")).toContain("\u001b");
		const picked = ui.select(accent("Pick"), [accent("one"), "two"]);
		const { interaction } = await answerNext({ kind: "choice", value: "0" });
		expect(interaction.title).toBe("Pick");
		expect(interaction.request).toMatchObject({
			options: [
				{ value: "0", label: "one" },
				{ value: "1", label: "two" },
			],
		});
		expect(await picked).toBe(accent("one"));

		const confirmed = ui.confirm(
			"T".repeat(MAX_NAME_CHARS + 10),
			`\u001b[31m${"b".repeat(MAX_TEXT_CHARS + 10)}\u001b[0m`,
		);
		const second = await log.next("interaction_requested");
		expect(second.interaction.title).toHaveLength(MAX_NAME_CHARS);
		expect(second.interaction.body).toHaveLength(MAX_TEXT_CHARS);
		ui.notify(`${accent("done")}\u001b]0;title\u0007`, "warning");
		expect(log.of("notice")).toEqual([{ type: "notice", level: "warning", text: "done" }]);
		desk.expireAll();
		expect(await confirmed).toBe(false);
		expect(log.invalid).toEqual([]);
	});
});

describe("notices and what a phone cannot show", () => {
	test("notify is a notice, info by default", () => {
		const { ui, log } = uiRig();
		ui.notify("saved");
		ui.notify("careful", "warning");
		ui.notify("broke", "error");
		expect(log.of("notice")).toEqual([
			{ type: "notice", level: "info", text: "saved" },
			{ type: "notice", level: "warning", text: "careful" },
			{ type: "notice", level: "error", text: "broke" },
		]);
	});

	test("custom() is undefined with a notice that the phone cannot show it", async () => {
		const { ui, log } = uiRig();
		expect(await ui.custom(() => ({ render: () => [], invalidate: () => {} }))).toBeUndefined();
		expect(log.of("notice")).toHaveLength(1);
		expect(log.of("notice")[0]).toMatchObject({ level: "warning" });
	});

	test("status, widgets, titles, working indicators, footer, header, editor and autocomplete do nothing", async () => {
		const { ui, log } = uiRig();
		ui.setStatus("k", "status");
		ui.setStatus("k", undefined);
		ui.setWidget("w", ["a line"]);
		ui.setWidget("w", undefined, { placement: "belowEditor" });
		ui.setWidget("w", () => ({ render: () => [], invalidate: () => {} }));
		ui.setTitle("title");
		ui.setWorkingMessage("working");
		ui.setWorkingVisible(false);
		ui.setWorkingIndicator({ frames: [] });
		ui.setHiddenThinkingLabel("hidden");
		ui.setFooter(undefined);
		ui.setHeader(undefined);
		ui.setEditorText("text");
		ui.pasteToEditor("paste");
		ui.addAutocompleteProvider((current) => current);
		ui.setEditorComponent(undefined);
		ui.setToolsExpanded(true);
		ui.onTerminalInput(() => undefined)();
		expect(log.events).toEqual([]);
	});

	test("what is read answers as Pi's RPC mode does", () => {
		const { ui } = uiRig();
		expect(ui.getEditorText()).toBe("");
		expect(ui.getEditorComponent()).toBeUndefined();
		expect(ui.getToolsExpanded()).toBe(false);
		expect(ui.getAllThemes()).toEqual([]);
		expect(ui.getTheme("dark")).toBeUndefined();
		expect(ui.setTheme("dark")).toMatchObject({ success: false });
	});

	test("the theme works without initTheme(), and every member of the interface is an own property, so Pi's copy keeps it", () => {
		const { ui } = uiRig();
		expect(ui.theme.fg("accent", "x")).toContain("x");
		const members = {
			select: true,
			confirm: true,
			input: true,
			notify: true,
			onTerminalInput: true,
			setStatus: true,
			setWorkingMessage: true,
			setWorkingVisible: true,
			setWorkingIndicator: true,
			setHiddenThinkingLabel: true,
			setWidget: true,
			setFooter: true,
			setHeader: true,
			setTitle: true,
			custom: true,
			pasteToEditor: true,
			setEditorText: true,
			getEditorText: true,
			editor: true,
			addAutocompleteProvider: true,
			setEditorComponent: true,
			getEditorComponent: true,
			theme: true,
			getAllThemes: true,
			getTheme: true,
			setTheme: true,
			getToolsExpanded: true,
			setToolsExpanded: true,
		} satisfies Record<keyof ExtensionUIContext, true>;
		const copy: ExtensionUIContext = { ...ui };
		expect(Object.keys(copy).sort()).toEqual(Object.keys(members).sort());
	});
});
