import { describe, expect, test } from "bun:test";
import {
	answerProblem,
	type FieldCondition,
	type FormValue,
	fieldIsActive,
	type InteractionRequest,
	type StringField,
} from "../contract";

const field = (key: string, required = false, when: FieldCondition[] = []): StringField => ({
	kind: "string",
	key,
	required,
	hidden: false,
	when,
	options: [],
	allowCustom: false,
});

const form = (fields: StringField[]): InteractionRequest => ({ kind: "form", fields });

const text = (value: string): FormValue => ({ kind: "text", value });

function problem(request: InteractionRequest, values: Record<string, FormValue>): string | undefined {
	return answerProblem(
		{ id: "i-1", createdAt: 1, title: "Asked", blocksRun: true, request },
		{ interactionId: "i-1", reply: { kind: "form", values } },
	);
}

/** A field key is any string, so it may be a name every JavaScript object inherits. */
describe("form field keys an object inherits", () => {
	const inherited = ["constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"];

	test("an optional field so named may be left unanswered", () => {
		for (const key of inherited) expect(problem(form([field(key)]), {})).toBeUndefined();
	});

	test("a required field so named still needs its answer, and takes one", () => {
		for (const key of inherited) {
			expect(problem(form([field(key, true)]), {})).toBe(`field ${key} is required`);
			expect(problem(form([field(key)]), { [key]: text("x") })).toBeUndefined();
		}
	});

	test("a condition on a field so named holds only on its own answer", () => {
		const gated = field("g", false, [{ key: "constructor", op: "neq", value: { kind: "text", value: "x" } }]);
		expect(fieldIsActive(gated, {})).toBe(false);
		expect(fieldIsActive(gated, { constructor: text("y") })).toBe(true);
	});
});
