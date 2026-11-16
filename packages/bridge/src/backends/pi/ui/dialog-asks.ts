/**
 * One of Pi's dialogs as the ask a phone shows, and the phone's reply as Pi's answer, for a hosted session's RPC
 * dialogs and a terminal's mirrored ones alike: `select` is a `choice`, `confirm` a `confirm`, `input` and `editor` a
 * `text`, and the questions an extension asks on `broski:questions` (carried in an `input`'s title by the bridge's own
 * extension) one `questions` interaction.
 */

import { MAX_LIST_ITEMS } from "../../../contract";
import { questionsAskOf } from "../host/protocol";
import { phoneName, phoneText } from "../phone-text";
import type { DialogRequest } from "../rpc/frames";
import type { AskOutcome, AskSpec } from "./interactions";
import { type AskedQuestion, answersOf, questionsAsk } from "./questions-dialog";

export type DialogAnswer = { readonly value: string } | { readonly confirmed: boolean } | { readonly cancelled: true };

export const CANCELLED: DialogAnswer = { cancelled: true };

/** A dialog as Pi describes it, without the id one channel or another gives it. */
export type DialogSpec = DistributiveOmit<DialogRequest, "id">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface Raised<Answer> {
	readonly spec: AskSpec;
	readonly answerOf: (outcome: Extract<AskOutcome, { kind: "answered" }>) => Answer;
}

/** Undefined for a `select` with no options, which nobody could answer. */
export function raisedAs(dialog: DialogSpec): Raised<DialogAnswer> | undefined {
	switch (dialog.method) {
		case "select":
			return selectAsk(dialog.title, dialog.options);
		case "confirm": {
			const body = phoneText(dialog.message);
			return {
				spec: { title: phoneName(dialog.title), ...(body !== "" && { body }), request: { kind: "confirm" } },
				answerOf: ({ reply }) => (reply.kind === "confirm" ? { confirmed: reply.confirmed } : CANCELLED),
			};
		}
		case "input": {
			const asked = questionsAskOf(dialog.title);
			if (asked !== undefined)
				return questionsRaised(asked.title, asked.questions, (answers) => JSON.stringify(answers));
			return textAsk(dialog.title, false, dialog.placeholder, undefined);
		}
		case "editor":
			return textAsk(dialog.title, true, undefined, dialog.prefill);
	}
}

/** Questions, answered as `value` holds them: JSON text over RPC, the answers themselves on the terminal's link. */
export function questionsRaised<Value>(
	title: string | undefined,
	asked: readonly AskedQuestion[],
	value: (answers: NonNullable<ReturnType<typeof answersOf>>) => Value,
): Raised<{ readonly value: Value } | { readonly cancelled: true }> {
	return {
		spec: questionsAsk(title, asked),
		answerOf: (outcome) => {
			const answers = answersOf(outcome, asked.length);
			return answers === undefined ? { cancelled: true } : { value: value(answers) };
		},
	};
}

function selectAsk(title: string, offered: readonly string[]): Raised<DialogAnswer> | undefined {
	const kept = offered.slice(0, MAX_LIST_ITEMS);
	if (kept.length === 0) return undefined;
	const options = kept.map((label, index) => ({ value: String(index), label: phoneName(label) }));
	return {
		spec: { title: phoneName(title), request: { kind: "choice", options } },
		answerOf: ({ reply }) => {
			const chosen = reply.kind === "choice" ? kept[Number(reply.value)] : undefined;
			return chosen === undefined ? CANCELLED : { value: chosen };
		},
	};
}

function textAsk(
	title: string,
	multiline: boolean,
	hint: string | undefined,
	prefill: string | undefined,
): Raised<DialogAnswer> {
	return {
		spec: {
			title: phoneName(title),
			request: {
				kind: "text",
				multiline,
				...(hint !== undefined && { placeholder: phoneName(hint) }),
				...(prefill !== undefined && { initialText: phoneText(prefill) }),
			},
		},
		answerOf: ({ reply }) => (reply.kind === "text" ? { value: reply.text } : CANCELLED),
	};
}
