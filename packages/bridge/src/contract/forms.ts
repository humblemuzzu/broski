import { z } from "zod";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { Option } from "./option";

export const TextValue = z.strictObject({ kind: z.literal("text"), value: z.string().max(MAX_TEXT_CHARS) });
export type TextValue = z.infer<typeof TextValue>;

export const NumberValue = z.strictObject({ kind: z.literal("number"), value: z.number() });
export type NumberValue = z.infer<typeof NumberValue>;

export const BooleanValue = z.strictObject({ kind: z.literal("boolean"), value: z.boolean() });
export type BooleanValue = z.infer<typeof BooleanValue>;

export const ChoicesValue = z.strictObject({
	kind: z.literal("choices"),
	values: z.array(z.string().max(MAX_NAME_CHARS)).max(MAX_LIST_ITEMS),
});
export type ChoicesValue = z.infer<typeof ChoicesValue>;

/** An answer to one form field. */
export const FormValue = z.discriminatedUnion("kind", [TextValue, NumberValue, BooleanValue, ChoicesValue]);
export type FormValue = z.infer<typeof FormValue>;

/** A value a visibility condition compares an earlier field's answer with. */
export const FormScalar = z.discriminatedUnion("kind", [TextValue, NumberValue, BooleanValue]);
export type FormScalar = z.infer<typeof FormScalar>;

export const ConditionOperator = z.enum(["eq", "neq"]);
export type ConditionOperator = z.infer<typeof ConditionOperator>;

/**
 * The key of a form field, and of its answer in a reply's `values`. Any string but `__proto__`:
 * `JSON.parse` gives a parsed object that key as its own, and zod's record parse drops it without a
 * word, so a field so keyed could never be answered. An adapter whose backend names a field
 * `__proto__` (an MCP server's form may) gives the phone another key and maps the answer back.
 */
export const FieldKey = z
	.string()
	.min(1)
	.max(MAX_NAME_CHARS)
	.regex(/^(?!__proto__$)/, "a field key cannot be __proto__");
export type FieldKey = z.infer<typeof FieldKey>;

/**
 * Against a multiselect answer `eq` means "includes" and `neq` "does not include". A condition on
 * an unanswered field is false for both operators.
 */
export const FieldCondition = z.strictObject({ key: FieldKey, op: ConditionOperator, value: FormScalar });
export type FieldCondition = z.infer<typeof FieldCondition>;

export const StringFormat = z.enum(["email", "uri", "date", "date-time"]);
export type StringFormat = z.infer<typeof StringFormat>;

const fieldBase = {
	key: FieldKey,
	title: z.string().max(MAX_NAME_CHARS).optional(),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	required: z.boolean(),
	/** Not shown; its default applies unless an answer is supplied. */
	hidden: z.boolean(),
	/** All conditions must hold for the field to be active; an inactive field is neither required nor answerable. */
	when: z.array(FieldCondition).max(MAX_LIST_ITEMS),
};

export const StringField = z.strictObject({
	kind: z.literal("string"),
	...fieldBase,
	format: StringFormat.optional(),
	minLength: z.int().nonnegative().optional(),
	maxLength: z.int().nonnegative().optional(),
	pattern: z.string().max(MAX_NAME_CHARS).optional(),
	placeholder: z.string().max(MAX_NAME_CHARS).optional(),
	defaultValue: z.string().max(MAX_TEXT_CHARS).optional(),
	/** When non-empty the answer must be one of these values, unless `allowCustom`. */
	options: z.array(Option).max(MAX_LIST_ITEMS),
	allowCustom: z.boolean(),
});
export type StringField = z.infer<typeof StringField>;

export const NumberField = z.strictObject({
	kind: z.literal("number"),
	...fieldBase,
	minimum: z.number().optional(),
	maximum: z.number().optional(),
	defaultValue: z.number().optional(),
});
export type NumberField = z.infer<typeof NumberField>;

export const IntegerField = z.strictObject({
	kind: z.literal("integer"),
	...fieldBase,
	minimum: z.int().optional(),
	maximum: z.int().optional(),
	defaultValue: z.int().optional(),
});
export type IntegerField = z.infer<typeof IntegerField>;

export const BooleanField = z.strictObject({
	kind: z.literal("boolean"),
	...fieldBase,
	defaultValue: z.boolean().optional(),
});
export type BooleanField = z.infer<typeof BooleanField>;

export const MultiselectField = z.strictObject({
	kind: z.literal("multiselect"),
	...fieldBase,
	options: z.array(Option).min(1).max(MAX_LIST_ITEMS),
	minItems: z.int().nonnegative().optional(),
	maxItems: z.int().nonnegative().optional(),
	allowCustom: z.boolean(),
	defaultValue: z.array(z.string().max(MAX_NAME_CHARS)).max(MAX_LIST_ITEMS).optional(),
});
export type MultiselectField = z.infer<typeof MultiselectField>;

export const FormFieldSpec = z.discriminatedUnion("kind", [
	StringField,
	NumberField,
	IntegerField,
	BooleanField,
	MultiselectField,
]);
export type FormFieldSpec = z.infer<typeof FormFieldSpec>;
