import { describe, expect, test } from "bun:test";
import { humanDenial } from "../../../backends/claude-code/ui/denial";
import type { Interaction, QuestionsReply, QuestionsRequest } from "../../../contract";
import { DeskRig } from "./desk-rig";

const COLOR = {
	question: "Which color?",
	header: "Color",
	multiSelect: false,
	options: [
		{ label: "Red", description: "warm" },
		{ label: "Blue", description: "cool" },
	],
};
const FEATURES = {
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [
		{ label: "Auth", description: "login" },
		{ label: "Sync", description: "cloud", preview: "<b>sync</b>" },
		{ label: "Dark", description: "theme" },
	],
};

function request(interaction: Interaction): QuestionsRequest {
	if (interaction.request.kind !== "questions") throw new Error(`a ${interaction.request.kind} ask`);
	return interaction.request;
}

function answers(...parts: QuestionsReply["answers"]): QuestionsReply {
	return { kind: "questions", answers: parts };
}

describe("AskUserQuestion", () => {
	test("becomes questions with index ids, custom text allowed and every question required", () => {
		const rig = new DeskRig();
		rig.tool("AskUserQuestion", { questions: [COLOR, FEATURES] }, { requiresUserInteraction: true });
		const interaction = rig.only();
		expect(interaction.title).toBe("2 questions from Claude");
		expect(interaction.origin).toMatchObject({ toolName: "AskUserQuestion" });
		expect(request(interaction).questions).toEqual([
			{
				id: "0",
				header: "Color",
				text: "Which color?",
				options: [
					{ label: "Red", description: "warm" },
					{ label: "Blue", description: "cool" },
				],
				multiSelect: false,
				allowCustom: true,
				secret: false,
				required: true,
			},
			{
				id: "1",
				header: "Features",
				text: "Which features?",
				options: [
					{ label: "Auth", description: "login" },
					{ label: "Sync", description: "cloud", preview: "<b>sync</b>" },
					{ label: "Dark", description: "theme" },
				],
				multiSelect: true,
				allowCustom: true,
				secret: false,
				required: true,
			},
		]);
	});

	test("the answer is the original input plus answers keyed by question text, multi-select joined with a comma", async () => {
		const rig = new DeskRig();
		const input = { questions: [COLOR, FEATURES], metadata: { source: "test" } };
		const ask = rig.tool("AskUserQuestion", input);
		const result = rig.answer(
			rig.only(),
			answers(
				{ questionId: "0", selected: ["Blue"] },
				{ questionId: "1", selected: ["Auth", "Dark"], custom: "Offline" },
			),
		);
		expect(result).toEqual({ status: "accepted" });
		expect(await ask.promise).toEqual({
			behavior: "allow",
			updatedInput: {
				...input,
				answers: { "Which color?": "Blue", "Which features?": "Auth, Dark, Offline" },
			},
		});
	});

	test("free text alone answers a question, and a question text named __proto__ stays an own key", async () => {
		const rig = new DeskRig();
		const proto = { ...COLOR, question: "__proto__" };
		const ask = rig.tool("AskUserQuestion", { questions: [proto] });
		rig.answer(rig.only(), answers({ questionId: "0", selected: [], custom: "Green" }));
		const result = await ask.promise;
		if (result?.behavior !== "allow") throw new Error("not allowed");
		const given = result.updatedInput?.answers;
		expect(given && Object.hasOwn(given, "__proto__")).toBe(true);
		expect(Object.entries(given ?? {})).toEqual([["__proto__", "Green"]]);
	});

	test("an answer to a question that needs one, or to no question, is refused", () => {
		const rig = new DeskRig();
		rig.tool("AskUserQuestion", { questions: [COLOR] });
		const interaction = rig.only();
		expect(rig.answer(interaction, answers())).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(rig.answer(interaction, answers({ questionId: "7", selected: ["Red"] }))).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect(rig.answer(interaction, answers({ questionId: "0", selected: ["Purple"] }))).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect(rig.pending()).toHaveLength(1);
	});

	test("a cancel is a plain deny, and a cancel that stops the run interrupts and aborts it", async () => {
		const rig = new DeskRig();
		const first = rig.tool("AskUserQuestion", { questions: [COLOR] });
		rig.answer(rig.only(), { kind: "cancel", stopRun: false });
		expect(await first.promise).toEqual({ behavior: "deny", message: humanDenial(undefined) });
		const second = rig.tool("AskUserQuestion", { questions: [COLOR] });
		const asked = rig.requested()[1];
		if (!asked) throw new Error("no second ask");
		rig.answer(asked, { kind: "cancel", stopRun: true, message: "Enough." });
		expect(await second.promise).toEqual({ behavior: "deny", message: humanDenial("Enough."), interrupt: true });
		expect(rig.aborts).toEqual(["abort"]);
	});

	test.each([
		["two questions with the same text", { questions: [COLOR, { ...FEATURES, question: COLOR.question }] }],
		["an option label twice", { questions: [{ ...COLOR, options: [COLOR.options[0], COLOR.options[0]] }] }],
		["no questions", { questions: [] }],
		["questions that are not a list", { questions: "Which color?" }],
		["a question without text", { questions: [{ ...COLOR, question: "" }] }],
	])("%s is raised as a decline-or-dismiss confirm, never answered for the person", async (_name, input) => {
		const rig = new DeskRig();
		const ask = rig.tool("AskUserQuestion", input);
		const interaction = rig.only();
		expect(interaction.request.kind).toBe("confirm");
		expect(interaction.title).toBe("Claude Code asked questions this app cannot show");
		expect(rig.pending()).toHaveLength(1);
		rig.answer(interaction, { kind: "confirm", confirmed: true });
		const result = await ask.promise;
		expect(result).toMatchObject({ behavior: "deny" });
		expect(result && "message" in result ? result.message : "").toContain("could not be shown");
	});
});
