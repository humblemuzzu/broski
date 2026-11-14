/** AskUserQuestion as `questions` (D15): ids by index, answers rebuilt keyed by question text, multi-select joined. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type Question,
	type QuestionsReply,
	type QuestionsRequest,
} from "../../../contract";
import { nameOr } from "../bounds";
import type { ToolAsk } from "./tool-ask";

const OptionInput = z.looseObject({
	label: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	preview: z.string().max(MAX_TEXT_CHARS).optional(),
});

const QuestionInput = z.looseObject({
	question: z.string().min(1).max(MAX_TEXT_CHARS),
	header: z.string().optional(),
	options: z.array(OptionInput).max(MAX_LIST_ITEMS),
	multiSelect: z.boolean().optional(),
});

const QuestionsInput = z.looseObject({ questions: z.array(QuestionInput).min(1).max(MAX_LIST_ITEMS) });

type QuestionInput = z.infer<typeof QuestionInput>;

const NOT_SHOWN = "The user declined: these questions could not be shown in the app. Ask in plain text instead.";

/** Undefined for an ask the contract cannot hold unambiguously: answers are keyed by text, so texts must differ. */
export function questionsAsk(input: Record<string, unknown>): ToolAsk | undefined {
	const parsed = QuestionsInput.safeParse(input);
	if (!parsed.success) return undefined;
	const inputs = parsed.data.questions;
	if (new Set(inputs.map((question) => question.question)).size !== inputs.length) return undefined;
	if (!inputs.every(distinctLabels)) return undefined;
	const request: QuestionsRequest = { kind: "questions", questions: inputs.map(questionOf) };
	const [first] = inputs;
	return {
		title: nameOr(
			inputs.length === 1 ? first?.question : `${inputs.length} questions from Claude`,
			"Questions from Claude",
		),
		request,
		decide: (reply) => (reply.kind === "questions" ? answered(input, inputs, reply) : undefined),
	};
}

/** For questions `questionsAsk` refuses: a person still decides, and a decline tells the model why. */
export function declinedQuestions(): ToolAsk {
	return {
		title: "Claude Code asked questions this app cannot show",
		body: "The questions repeat a text or are not in the usual shape, so answers could not be matched to them. Confirm to decline them; dismissing this card denies the tool call too. Nothing is answered for you.",
		request: { kind: "confirm" },
		decide: (reply) => (reply.kind === "confirm" ? { behavior: "deny", message: NOT_SHOWN } : undefined),
	};
}

function distinctLabels(question: QuestionInput): boolean {
	return new Set(question.options.map((option) => option.label)).size === question.options.length;
}

function questionOf(question: QuestionInput, index: number): Question {
	const header = question.header === undefined ? "" : nameOr(question.header, "");
	return {
		id: String(index),
		...(header !== "" && { header }),
		text: question.question,
		options: question.options.map((option) => ({
			label: option.label,
			...(option.description !== undefined && option.description !== "" && { description: option.description }),
			...(option.preview !== undefined && option.preview !== "" && { preview: option.preview }),
		})),
		multiSelect: question.multiSelect === true,
		allowCustom: true,
		secret: false,
		required: true,
	};
}

function answered(
	input: Record<string, unknown>,
	questions: readonly QuestionInput[],
	reply: QuestionsReply,
): PermissionResult {
	const entries: [string, string][] = [];
	questions.forEach((question, index) => {
		const answer = reply.answers.find((candidate) => candidate.questionId === String(index));
		if (!answer) return;
		entries.push([
			question.question,
			[...answer.selected, ...(answer.custom === undefined ? [] : [answer.custom])].join(", "),
		]);
	});
	return { behavior: "allow", updatedInput: { ...input, answers: Object.fromEntries(entries) } };
}
