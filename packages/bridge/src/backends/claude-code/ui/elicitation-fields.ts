/** One property of an MCP elicitation's flat JSON Schema as a contract form field; undefined when it has no fit. */

import {
	type FormFieldSpec,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type Option,
	type StringField,
	type StringFormat,
} from "../../../contract";
import { clip } from "../bounds";
import { isRecord } from "../json";
import { plain } from "./text";

type Definition = Record<string, unknown>;

interface Base {
	readonly key: string;
	readonly title?: string;
	readonly description?: string;
	readonly required: boolean;
	readonly hidden: false;
	readonly when: [];
}

const FORMATS: readonly string[] = ["email", "uri", "date", "date-time"];

export function fieldFor(key: string, definition: unknown, required: boolean): FormFieldSpec | undefined {
	if (!isRecord(definition)) return undefined;
	const base = baseOf(key, definition, required);
	switch (definition.type) {
		case "string":
			return definition.enum !== undefined || definition.oneOf !== undefined
				? choiceField(base, definition)
				: stringField(base, definition);
		case "number":
			return { kind: "number", ...base, ...bounds(definition, finite, finite), ...defaultOf(definition, finite) };
		case "integer":
			return {
				kind: "integer",
				...base,
				...bounds(definition, ceiled, floored),
				...defaultOf(definition, safeInt),
			};
		case "boolean":
			return {
				kind: "boolean",
				...base,
				...(typeof definition.default === "boolean" && { defaultValue: definition.default }),
			};
		case "array":
			return multiselectField(base, definition);
		default:
			return undefined;
	}
}

function baseOf(key: string, definition: Definition, required: boolean): Base {
	const title = typeof definition.title === "string" ? plain(definition.title, MAX_NAME_CHARS).trim() : "";
	const description = typeof definition.description === "string" ? plain(definition.description, MAX_TEXT_CHARS) : "";
	return {
		key,
		...(title !== "" && { title }),
		...(description !== "" && { description }),
		required,
		hidden: false,
		when: [],
	};
}

function stringField(base: Base, definition: Definition): StringField {
	const format = FORMATS.find((candidate): candidate is StringFormat => candidate === definition.format);
	const pattern = typeof definition.pattern === "string" ? definition.pattern : undefined;
	return {
		kind: "string",
		...base,
		...(format !== undefined && { format }),
		...(count(definition.minLength) !== undefined && { minLength: count(definition.minLength) }),
		...(count(definition.maxLength) !== undefined && { maxLength: count(definition.maxLength) }),
		...(pattern !== undefined && usablePattern(pattern) && { pattern }),
		...(typeof definition.default === "string" && { defaultValue: clip(definition.default, MAX_TEXT_CHARS) }),
		options: [],
		allowCustom: false,
	};
}

function choiceField(base: Base, definition: Definition): StringField | undefined {
	const options = choicesOf(definition.enum, definition.enumNames, definition.oneOf);
	if (!options) return undefined;
	const fallback = typeof definition.default === "string" ? definition.default : undefined;
	const defaultValue = options.some((option) => option.value === fallback) ? fallback : undefined;
	return {
		kind: "string",
		...base,
		...(defaultValue !== undefined && { defaultValue }),
		options,
		allowCustom: false,
	};
}

function multiselectField(base: Base, definition: Definition): FormFieldSpec | undefined {
	const items = definition.items;
	if (!isRecord(items) || items.type !== "string") return undefined;
	const options = choicesOf(items.enum, undefined, items.anyOf ?? items.oneOf);
	if (!options) return undefined;
	const known = new Set(options.map((option) => option.value));
	const defaults = Array.isArray(definition.default)
		? definition.default.filter((value): value is string => typeof value === "string" && known.has(value))
		: [];
	return {
		kind: "multiselect",
		...base,
		options,
		...(count(definition.minItems) !== undefined && { minItems: count(definition.minItems) }),
		...(count(definition.maxItems) !== undefined && { maxItems: count(definition.maxItems) }),
		allowCustom: false,
		...(defaults.length > 0 && { defaultValue: defaults }),
	};
}

/** `enum` (with the old `enumNames` labels) or `oneOf`/`anyOf` of `{const, title}`; undefined if neither is usable. */
function choicesOf(values: unknown, names: unknown, titled: unknown): Option[] | undefined {
	const options = Array.isArray(titled) ? titledOptions(titled) : plainOptions(values, names);
	if (!options || options.length === 0 || options.length > MAX_LIST_ITEMS) return undefined;
	const seen = new Set<string>();
	return options.filter((option) => !seen.has(option.value) && seen.add(option.value));
}

function plainOptions(values: unknown, names: unknown): Option[] | undefined {
	if (!Array.isArray(values) || !values.every(fitsName)) return undefined;
	const labels = Array.isArray(names) ? names : [];
	return values.map((value, index) => {
		const label = labels[index];
		return { value, label: typeof label === "string" && label !== "" ? clip(label, MAX_NAME_CHARS) : value };
	});
}

function titledOptions(entries: readonly unknown[]): Option[] | undefined {
	const options: Option[] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || !fitsName(entry.const)) return undefined;
		const title = entry.title;
		options.push({
			value: entry.const,
			label: typeof title === "string" && title !== "" ? clip(title, MAX_NAME_CHARS) : entry.const,
		});
	}
	return options;
}

function fitsName(value: unknown): value is string {
	return typeof value === "string" && value.length <= MAX_NAME_CHARS;
}

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function ceiled(value: unknown): number | undefined {
	return safeInt(typeof value === "number" ? Math.ceil(value) : undefined);
}

function floored(value: unknown): number | undefined {
	return safeInt(typeof value === "number" ? Math.floor(value) : undefined);
}

function bounds(
	definition: Definition,
	low: (value: unknown) => number | undefined,
	high: (value: unknown) => number | undefined,
) {
	const minimum = low(definition.minimum);
	const maximum = high(definition.maximum);
	return { ...(minimum !== undefined && { minimum }), ...(maximum !== undefined && { maximum }) };
}

function defaultOf(definition: Definition, read: (value: unknown) => number | undefined) {
	const value = read(definition.default);
	return value === undefined ? {} : { defaultValue: value };
}

/** The contract checks a pattern under every reading a backend may use; one that fails to compile can never be met. */
function usablePattern(pattern: string): boolean {
	if (pattern.length > MAX_NAME_CHARS) return false;
	try {
		new RegExp(pattern);
		new RegExp(pattern, "u");
		return true;
	} catch {
		return false;
	}
}
