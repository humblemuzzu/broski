/**
 * The questions an extension asks through Pi's event bus (`broski:questions`,
 * `docs/architecture/backends/pi/extension-hints.md`) as one `questions` interaction, and a person's reply as the
 * answers the extension reads: per question, in order, the labels picked and any words of their own.
 */

import { z } from "zod";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS, type Question } from "../../../contract";
import { phoneName, phoneText } from "../phone-text";
import type { AskOutcome, AskSpec } from "./interactions";

const MAX_QUESTIONS = 20;

export const AskedQuestion = z.object({
	question: z.string().min(1).max(MAX_TEXT_CHARS),
	header: z.string().max(MAX_NAME_CHARS).optional(),
	options: z
		.array(
			z.object({
				label: z.string().min(1).max(MAX_NAME_CHARS),
				description: z.string().max(MAX_TEXT_CHARS).optional(),
			}),
		)
		.max(MAX_LIST_ITEMS)
		.optional(),
	multiple: z.boolean().optional(),
});
export type AskedQuestion = z.infer<typeof AskedQuestion>;

export const AskedQuestions = z.array(AskedQuestion).min(1).max(MAX_QUESTIONS);

export const QuestionAnswers = z
	.array(
		z.object({
			selected: z.array(z.string().max(MAX_NAME_CHARS)).max(MAX_LIST_ITEMS),
			custom: z.string().max(MAX_TEXT_CHARS).optional(),
		}),
	)
	.max(MAX_QUESTIONS);
export type QuestionAnswers = z.infer<typeof QuestionAnswers>;

/** The questions as the phone is asked them, and its reply as the answers the asker reads. */
export interface QuestionsDialog {
	readonly spec: AskSpec;
	/** The answers in the questions' order, each pick the label the asker offered; a question left out has none. */
	answersOf(outcome: Extract<AskOutcome, { kind: "answered" }>): QuestionAnswers | undefined;
}

/** Every question takes words of the person's own, as a picker's "type your own answer" row does; none is required. */
export function questionsDialog(title: string | undefined, asked: readonly AskedQuestion[]): QuestionsDialog {
	const offered = asked.map((item) => shownLabels(item.options ?? []));
	const questions = asked.map((item, index): Question => {
		const header = item.header === undefined ? "" : phoneName(item.header);
		const shown = offered[index] ?? new Map<string, string>();
		return {
			id: String(index).slice(0, MAX_ID_CHARS),
			...(header !== "" && { header }),
			text: phoneText(item.question),
			options: [...shown.keys()].map((label, at) => {
				const description = item.options?.[at]?.description;
				return { label, ...(description !== undefined && { description: phoneText(description) }) };
			}),
			multiSelect: item.multiple === true,
			allowCustom: true,
			secret: false,
			required: false,
		};
	});
	const shownTitle = phoneName(title ?? "");
	return {
		spec: {
			title: shownTitle !== "" ? shownTitle : (questions[0]?.text.split("\n")[0] ?? "A question"),
			request: { kind: "questions", questions },
		},
		answersOf: (outcome) => answersOf(outcome, offered),
	};
}

/**
 * Each option's label as the phone shows it, to the label the asker offered, in the options' order. A label that
 * cleans to nothing or to one already shown is `Option N`: the contract takes neither.
 */
function shownLabels(options: NonNullable<AskedQuestion["options"]>): Map<string, string> {
	const shown = new Map<string, string>();
	options.forEach((option, index) => {
		let label = phoneName(option.label);
		if (label === "" || shown.has(label)) label = `Option ${index + 1}`;
		while (shown.has(label)) label = `${label}'`;
		shown.set(label, option.label);
	});
	return shown;
}

function answersOf(
	outcome: Extract<AskOutcome, { kind: "answered" }>,
	offered: readonly ReadonlyMap<string, string>[],
): QuestionAnswers | undefined {
	const { reply } = outcome;
	if (reply.kind !== "questions") return undefined;
	return offered.map((labels, index) => {
		const given = reply.answers.find((answer) => answer.questionId === String(index));
		return {
			selected: (given?.selected ?? []).map((label) => labels.get(label) ?? label),
			...(given?.custom !== undefined && given.custom !== "" && { custom: given.custom }),
		};
	});
}
