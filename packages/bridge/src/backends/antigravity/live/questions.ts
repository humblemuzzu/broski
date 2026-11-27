/**
 * agy's questions (its `ask_question` tool) as the contract's `questions`, and the person's answers back. agy 1.5.18
 * asks with a form elicitation whose properties are `q1`, `q2`, …: a string with `oneOf` choices is one pick, an array
 * whose `items.anyOf` holds the choices is several, and a `qN_other` string beside one takes the person's own words.
 * Choices keep agy's titles as written ("(Recommended)" included) and go back as their `const`. The schema's untitled
 * choices (`enum`, `items.enum`) read as choices titled by their value, and a `qN` string with no choices as a question
 * answered in the person's words (ACP `StringPropertySchema`, `MultiSelectPropertySchema`). Any other form is not one
 * the phone can show.
 */

import { z } from "zod";
import { phoneName, phoneText } from "../../../adapter-kit/phone-text";
import {
	type InteractionReply,
	MAX_LIST_ITEMS,
	type Question,
	type QuestionOption,
	type QuestionsReply,
} from "../../../contract";
import type { ElicitationRequest } from "../acp/frames";

const EnumOption = z.object({ const: z.string(), title: z.string(), description: z.string().optional() });
const Choices = z.union([
	z.object({ oneOf: z.array(EnumOption).min(1) }),
	z.object({ anyOf: z.array(EnumOption).min(1) }),
	z.object({ enum: z.array(z.string()).min(1) }),
]);
const Property = z.object({ type: z.string(), title: z.string().optional(), description: z.string().optional() });
const Several = z.object({ type: z.literal("array"), items: Choices });
const Words = z.object({ type: z.literal("string") });
const QUESTION_KEY = /^q(\d+)$/;

interface Field {
	readonly key: string;
	/** Choice labels to the `const` each goes back as. */
	readonly choices: ReadonlyMap<string, string>;
	readonly multi: boolean;
	/** Where the person's own words go: `qN_other`, or `qN` itself for a question with no choices. */
	readonly wordsKey?: string;
}

export interface QuestionForm {
	readonly title: string;
	readonly questions: Question[];
	readonly fields: ReadonlyMap<string, Field>;
}

export type ElicitationResult =
	| { readonly action: "accept"; readonly content: Record<string, string | string[]> }
	| { readonly action: "decline" | "cancel" };

interface Shape {
	readonly text: string | undefined;
	readonly options: QuestionOption[];
	readonly choices: ReadonlyMap<string, string>;
	readonly multi: boolean;
}

/** Undefined for a request that is not a form of agy's questions. */
export function questionForm(request: ElicitationRequest): QuestionForm | undefined {
	const properties = request.requestedSchema?.properties;
	if (request.mode !== "form" || properties === undefined) return undefined;
	const keys = Object.keys(properties);
	const numbers = keys.flatMap((key) => QUESTION_KEY.exec(key)?.[1] ?? []).sort((a, b) => Number(a) - Number(b));
	const known = new Set(numbers.flatMap((n) => [`q${n}`, `q${n}_other`]));
	if (numbers.length === 0 || numbers.length > MAX_LIST_ITEMS || keys.some((key) => !known.has(key))) return undefined;
	const required = new Set(request.requestedSchema?.required ?? []);
	const read = numbers.map((n) => questionOf(n, properties, required, request.message));
	const entries = read.flatMap((entry) => entry ?? []);
	if (entries.length !== read.length) return undefined;
	return {
		title: phoneName(request.message) || "Antigravity has a question",
		questions: entries.map((entry) => entry.question),
		fields: new Map(entries.map((entry) => [entry.question.id, entry.field])),
	};
}

/** The `elicitation/create` result for a reply `answerProblem` passed: a dismissal declines, a stop cancels. */
export function elicitationResult(form: QuestionForm, reply: InteractionReply): ElicitationResult {
	if (reply.kind === "questions") return { action: "accept", content: contentOf(form, reply) };
	return { action: reply.kind === "cancel" && reply.stopRun ? "cancel" : "decline" };
}

function questionOf(
	n: string,
	properties: Readonly<Record<string, unknown>>,
	required: ReadonlySet<string>,
	message: string,
): { question: Question; field: Field } | undefined {
	const key = `q${n}`;
	const otherKey = `q${n}_other`;
	const other = properties[otherKey];
	if (other !== undefined && !Words.safeParse(other).success) return undefined;
	const shape = shapeOf(properties[key]);
	if (shape === undefined) return undefined;
	const wordsKey = shape.choices.size === 0 ? key : other !== undefined ? otherKey : undefined;
	const question: Question = {
		id: key,
		text: phoneText(shape.text ?? "") || phoneText(message) || `Question ${n}`,
		options: shape.options,
		multiSelect: shape.multi,
		allowCustom: wordsKey !== undefined,
		secret: false,
		required: required.has(key),
	};
	return { question, field: { key, choices: shape.choices, multi: shape.multi, ...(wordsKey && { wordsKey }) } };
}

function shapeOf(property: unknown): Shape | undefined {
	const read = Property.safeParse(property);
	if (!read.success) return undefined;
	const text = read.data.title ?? read.data.description;
	const several = Several.safeParse(property);
	if (several.success) return choicesOf(text, several.data.items, true);
	if (read.data.type !== "string") return undefined;
	const single = Choices.safeParse(property);
	if (single.success) return choicesOf(text, single.data, false);
	return { text, options: [], choices: new Map(), multi: false };
}

/** Undefined when two choices would show the same label: the answer names a choice by its label. */
function choicesOf(text: string | undefined, list: z.infer<typeof Choices>, multi: boolean): Shape | undefined {
	const listed: ReadonlyArray<z.infer<typeof EnumOption>> =
		"oneOf" in list
			? list.oneOf
			: "anyOf" in list
				? list.anyOf
				: list.enum.map((value) => ({ const: value, title: value }));
	const options: QuestionOption[] = [];
	const choices = new Map<string, string>();
	for (const choice of listed.slice(0, MAX_LIST_ITEMS)) {
		const label = phoneName(choice.title) || phoneName(choice.const);
		if (label === "" || choices.has(label)) return undefined;
		const description = phoneText(choice.description ?? "");
		choices.set(label, choice.const);
		options.push({ label, ...(description !== "" && { description }) });
	}
	return { text, options, choices, multi };
}

function contentOf(form: QuestionForm, reply: QuestionsReply): Record<string, string | string[]> {
	const content: Record<string, string | string[]> = {};
	for (const answer of reply.answers) {
		const field = form.fields.get(answer.questionId);
		if (field === undefined) continue;
		const picked = answer.selected.flatMap((label) => field.choices.get(label) ?? []);
		if (picked.length > 0) content[field.key] = field.multi ? picked : (picked[0] ?? "");
		if (answer.custom !== undefined && field.wordsKey !== undefined) content[field.wordsKey] = answer.custom;
	}
	return content;
}
