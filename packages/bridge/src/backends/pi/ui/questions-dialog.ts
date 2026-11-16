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

/** Every question takes words of the person's own, as a picker's "type your own answer" row does; none is required. */
export function questionsAsk(title: string | undefined, asked: readonly AskedQuestion[]): AskSpec {
	const questions = asked.map((item, index): Question => {
		const header = item.header === undefined ? "" : phoneName(item.header).trim();
		return {
			id: String(index).slice(0, MAX_ID_CHARS),
			...(header !== "" && { header }),
			text: phoneText(item.question),
			options: (item.options ?? []).map((option) => ({
				label: phoneName(option.label),
				...(option.description !== undefined && { description: phoneText(option.description) }),
			})),
			multiSelect: item.multiple === true,
			allowCustom: true,
			secret: false,
			required: false,
		};
	});
	const shown = phoneName(title ?? "").trim();
	return {
		title: shown !== "" ? shown : (questions[0]?.text.split("\n")[0] ?? "A question"),
		request: { kind: "questions", questions },
	};
}

/** The answers in the questions' order; a question left out of the reply has none. */
export function answersOf(
	outcome: Extract<AskOutcome, { kind: "answered" }>,
	count: number,
): QuestionAnswers | undefined {
	const { reply } = outcome;
	if (reply.kind !== "questions") return undefined;
	return Array.from({ length: count }, (_, index) => {
		const given = reply.answers.find((answer) => answer.questionId === String(index));
		return {
			selected: given?.selected ?? [],
			...(given?.custom !== undefined && given.custom !== "" && { custom: given.custom }),
		};
	});
}
