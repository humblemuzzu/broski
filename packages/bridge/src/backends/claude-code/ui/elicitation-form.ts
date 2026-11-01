/** An MCP form: its flat JSON Schema as contract fields, and a person's answers back as the content the server reads. */

import { answerFor, type FormFieldSpec, type FormValue, MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../../contract";
import { isRecord } from "../json";
import { fieldFor } from "./elicitation-fields";

export type ElicitationContent = Record<string, string | number | boolean | string[]>;

export interface FormPlan {
	readonly fields: FormFieldSpec[];
	/** A field's contract key to the server's property name: they differ only for `__proto__` (`FieldKey` refuses it). */
	readonly names: ReadonlyMap<string, string>;
}

/** Undefined when a property or the schema has no contract form (nested objects, arrays of objects, `$ref`, …). */
export function formPlan(schema: Record<string, unknown> | undefined): FormPlan | undefined {
	if (schema === undefined) return { fields: [], names: new Map() };
	if (schema.type !== undefined && schema.type !== "object") return undefined;
	if (schema.properties === undefined)
		return schema.required === undefined ? { fields: [], names: new Map() } : undefined;
	if (!isRecord(schema.properties)) return undefined;
	const properties = Object.entries(schema.properties);
	if (properties.length > MAX_LIST_ITEMS) return undefined;
	const required = new Set(Array.isArray(schema.required) ? schema.required : []);
	if (![...required].every((name) => properties.some(([property]) => property === name))) return undefined;
	const keys = contractKeys(properties.map(([name]) => name));
	if (!keys) return undefined;
	const fields: FormFieldSpec[] = [];
	const names = new Map<string, string>();
	for (const [index, [name, definition]] of properties.entries()) {
		const key = keys[index];
		const field = key === undefined ? undefined : fieldFor(key, definition, required.has(name));
		if (!field || key === undefined) return undefined;
		fields.push(field);
		names.set(key, name);
	}
	return { fields, names };
}

/** The server's names as field keys, in order: `__proto__` gets another key no property uses. */
function contractKeys(names: readonly string[]): string[] | undefined {
	if (names.some((name) => name === "" || name.length > MAX_NAME_CHARS)) return undefined;
	const taken = new Set(names);
	return names.map((name) => {
		if (name !== "__proto__") return name;
		let alias = "_proto_";
		while (taken.has(alias)) alias += "_";
		taken.add(alias);
		return alias;
	});
}

/** The content for an `accept`: only what was answered, under the server's own names (an own `__proto__` key stays one). */
export function formContent(plan: FormPlan, values: Record<string, FormValue>): ElicitationContent {
	const entries: [string, string | number | boolean | string[]][] = [];
	for (const field of plan.fields) {
		const value = answerFor(values, field.key);
		if (value !== undefined) entries.push([plan.names.get(field.key) ?? field.key, contentOf(value)]);
	}
	return Object.fromEntries(entries);
}

function contentOf(value: FormValue): string | number | boolean | string[] {
	return value.kind === "choices" ? [...value.values] : value.value;
}
