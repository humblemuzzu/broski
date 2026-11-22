/**
 * What an extension's dialog shows on the phone (`ui/dialog-asks.ts`): a person allows or answers on this text, so a
 * bidi override that reorders it, a control character or a line break in a one-line title never reaches the phone.
 */

import { describe, expect, test } from "bun:test";
import { raisedAs } from "../../backends/pi/ui/dialog-asks";
import type { AskSpec } from "../../backends/pi/ui/interactions";

const RLO = "\u202E";
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function shown(spec: AskSpec | undefined): string[] {
	const texts: string[] = [];
	JSON.stringify(spec, (_key, value: unknown) => {
		if (typeof value === "string") texts.push(value);
		return value;
	});
	return texts;
}

describe("an extension's dialog on the phone", () => {
	test("a select's title and options lose bidi overrides, controls and line breaks; the answer is still the option", () => {
		const raised = raisedAs({
			method: "select",
			title: `Run ${RLO}exe.txt\r\nnow\u0007`,
			options: [`a${RLO}b`, "c\u0000"],
		});
		expect(raised?.spec).toEqual({
			title: "Run exe.txt now",
			request: {
				kind: "choice",
				options: [
					{ value: "0", label: "ab" },
					{ value: "1", label: "c" },
				],
			},
		});
		const answer = raised?.answerOf({ kind: "answered", reply: { kind: "choice", value: "0" } });
		expect(answer).toEqual({ value: `a${RLO}b` });
	});

	test("a confirm's title is one clean line, and its body keeps its lines but loses what hides or reorders text", () => {
		const raised = raisedAs({
			method: "confirm",
			title: `Delete\r${RLO}all?`,
			message: `rm -rf ${RLO}/tmp\r\n\u0085done`,
		});
		expect(raised?.spec).toMatchObject({ title: "Delete all?", body: "rm -rf /tmp\r\ndone" });
	});

	test("an input's title and placeholder, and an editor's prefill, show nothing hidden", () => {
		const input = raisedAs({ method: "input", title: `Name${RLO}\r`, placeholder: `e.g.\u2066 x` });
		expect(input?.spec).toMatchObject({ title: "Name", request: { kind: "text", placeholder: "e.g. x" } });
		const editor = raisedAs({ method: "editor", title: "Edit", prefill: `a\u202Db\u0008` });
		expect(editor?.spec.request).toMatchObject({ initialText: "ab" });
	});

	test("questions on broski:questions show their title, headers, questions and options clean", () => {
		const asked = {
			title: `Pick\r${RLO}one`,
			questions: [
				{
					question: `Which ${RLO}store?\u0007`,
					header: `Store\u2067`,
					options: [{ label: `SQL${RLO}ite`, description: `local\u0000 file` }],
				},
			],
		};
		const raised = raisedAs({ method: "input", title: `broski-questions:${JSON.stringify(asked)}` });
		expect(raised?.spec).toMatchObject({
			title: "Pick one",
			request: {
				kind: "questions",
				questions: [
					{ header: "Store", text: "Which store?", options: [{ label: "SQLite", description: "local file" }] },
				],
			},
		});
		for (const text of shown(raised?.spec)) expect(text).not.toMatch(HIDDEN);
	});
});
