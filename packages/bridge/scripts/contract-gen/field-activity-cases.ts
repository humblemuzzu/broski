import {
	type FieldCondition,
	type FormFieldSpec,
	type FormScalar,
	type FormValue,
	fieldIsActive,
	type JsonValue,
} from "../../src/contract";

const SCALARS: readonly FormScalar[] = [
	{ kind: "text", value: "a" },
	{ kind: "text", value: "" },
	{ kind: "number", value: 1 },
	{ kind: "number", value: 1.5 },
	{ kind: "boolean", value: true },
	{ kind: "boolean", value: false },
];

const ANSWERS: readonly (FormValue | undefined)[] = [
	undefined,
	{ kind: "text", value: "a" },
	{ kind: "text", value: "b" },
	{ kind: "number", value: 1 },
	{ kind: "number", value: 1.5 },
	{ kind: "boolean", value: true },
	{ kind: "boolean", value: false },
	{ kind: "choices", values: [] },
	{ kind: "choices", values: ["a"] },
	{ kind: "choices", values: ["b", "a"] },
	{ kind: "choices", values: ["1"] },
];

function field(when: FieldCondition[]): FormFieldSpec {
	return { kind: "boolean", key: "f", required: false, hidden: false, when };
}

/**
 * `fieldIsActive` over every operator, every scalar a condition compares with and every kind of
 * answer, missing ones included; then conditions that must all hold, and an external field.
 */
export function fieldActivityCases(): JsonValue[] {
	const single = (["eq", "neq"] as const).flatMap((op) =>
		SCALARS.flatMap((value) =>
			ANSWERS.map((answer) => {
				const values: Record<string, FormValue> = answer === undefined ? {} : { k: answer };
				return activity(field([{ key: "k", op, value }]), values);
			}),
		),
	);
	const both = field([
		{ key: "k", op: "eq", value: { kind: "text", value: "a" } },
		{ key: "j", op: "neq", value: { kind: "boolean", value: true } },
	]);
	const text = (value: string): FormValue => ({ kind: "text", value });
	const flag = (value: boolean): FormValue => ({ kind: "boolean", value });
	const inherited = field([{ key: "constructor", op: "neq", value: { kind: "text", value: "x" } }]);
	return [
		...single,
		activity(field([]), {}),
		activity(both, { k: text("a"), j: flag(false) }),
		activity(both, { k: text("a"), j: flag(true) }),
		activity(both, { k: text("a") }),
		activity(both, { j: flag(false) }),
		activity({ kind: "external", key: "e", url: "https://example.com" }, {}),
		activity(inherited, {}),
		activity(inherited, { constructor: text("y") }),
	];
}

function activity(spec: FormFieldSpec, values: Record<string, FormValue>): JsonValue {
	return JSON.parse(JSON.stringify({ field: spec, values, active: fieldIsActive(spec, values) }));
}
