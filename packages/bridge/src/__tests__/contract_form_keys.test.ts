import { describe, expect, test } from "bun:test";
import {
	answerProblem,
	ClientMessage,
	type FieldCondition,
	FieldKey,
	FormFieldSpec,
	type FormValue,
	fieldIsActive,
	Interaction,
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

/**
 * `JSON.parse` gives an object a `__proto__` key of its own, and zod's record parse drops that key
 * without a word. It is the one key a reply cannot carry, so the contract does not let a form have it.
 */
describe("the one field key that cannot be answered", () => {
	const message = (key: string) =>
		JSON.parse(
			`{"type":"interaction.answer","requestId":"r","session":{"backend":"pi","sessionId":"s"},"answer":{"interactionId":"i","reply":{"kind":"form","values":{${JSON.stringify(key)}:{"kind":"text","value":"v"}}}}}`,
		);

	/** Every name an object, a function or an array inherits, and the names around them. */
	const names = [
		...Object.getOwnPropertyNames(Object.prototype),
		...Object.getOwnPropertyNames(Function.prototype),
		...Object.getOwnPropertyNames(Array.prototype),
		"prototype",
		"toJSON",
		"__PROTO__",
		" __proto__",
		"__proto__ ",
		"a__proto__",
	].filter((name) => name !== "__proto__");

	test("no other key is lost between JSON.parse and the schema", () => {
		expect(names.length).toBeGreaterThan(50);
		for (const key of new Set(names)) {
			const parsed = ClientMessage.safeParse(message(key));
			if (!parsed.success || parsed.data.type !== "interaction.answer" || parsed.data.answer.reply.kind !== "form")
				throw new Error(`${key} did not parse as a form answer`);
			expect(Object.hasOwn(parsed.data.answer.reply.values, key)).toBe(true);
		}
	});

	test("an answer keyed __proto__ is refused, with the reason, instead of arriving without the key", () => {
		const parsed = ClientMessage.safeParse(message("__proto__"));
		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues).toMatchObject([
			{ path: ["answer", "reply", "values"], message: "a field key cannot be __proto__" },
		]);
	});

	test("a field cannot be keyed __proto__, nor a condition name it", () => {
		const spec = {
			kind: "string",
			key: "__proto__",
			required: false,
			hidden: false,
			when: [],
			options: [],
			allowCustom: false,
		};
		expect(FormFieldSpec.safeParse(spec).success).toBe(false);
		expect(FormFieldSpec.safeParse({ ...spec, key: "proto" }).success).toBe(true);
		const condition = { key: "__proto__", op: "eq", value: { kind: "text", value: "x" } };
		expect(FormFieldSpec.safeParse({ ...spec, key: "g", when: [condition] }).success).toBe(false);
		const ask = (key: string) => ({
			id: "i",
			createdAt: 1,
			title: "Asked",
			blocksRun: true,
			request: { kind: "form", fields: [{ ...spec, key }] },
		});
		expect(Interaction.safeParse(ask("proto")).success).toBe(true);
		expect(Interaction.safeParse(ask("__proto__")).success).toBe(false);
		expect(FieldKey.safeParse("__proto__").success).toBe(false);
		expect(FieldKey.safeParse("__proto__x").success).toBe(true);
	});

	test("the checker still faults such an answer when it is handed one beyond the wire", () => {
		const values = JSON.parse('{"__proto__":{"kind":"text","value":"v"}}');
		expect(problem(form([field("a")]), values)).toBe("no field __proto__");
	});
});
