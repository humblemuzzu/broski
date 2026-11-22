import { ACCENT_HEX_PATTERN, namedSchemas } from "../../src/contract";
import type { JsonValue } from "../../src/contract/json";
import { type ContractSchemaDocument, refName, type Schema } from "./json-schema";

type Shape = "full" | "minimal";

const SAMPLE_UUID = "00000000-0000-4000-8000-000000000000";
const SAMPLE_BASE64 = "eA==";
const SAMPLE_URL = "https://example.com/x";
const SAMPLE_JSON: JsonValue = { text: "x", list: [1, 2.5, true, null], nested: { ok: false } };
/** A sample of each pattern that `x` does not match, by the pattern's source. */
const PATTERN_SAMPLES = new Map([[ACCENT_HEX_PATTERN.source, "#D97757"]]);

/**
 * Samples of every named type, keyed by type name: both shapes of every object, every member of
 * every union, every value of every enum. Each sample is parsed by the type's zod schema, so a
 * sample is proof that the validator accepts what the JSON Schema describes.
 */
export function contractSamples(document: ContractSchemaDocument): Record<string, JsonValue[]> {
	const sampler = new Sampler(document);
	const zodSchemas = new Map(namedSchemas().map((named) => [named.id, named.schema]));
	const samples: Record<string, JsonValue[]> = {};
	for (const name of Object.keys(document.$defs)) {
		const values = sampler.samplesOf(name);
		const schema = zodSchemas.get(name);
		if (!schema) throw new Error(`no zod schema named ${name}`);
		for (const value of values) {
			const parsed = schema.safeParse(value);
			if (!parsed.success) throw new Error(`${name}: zod rejects ${JSON.stringify(value)}: ${parsed.error.message}`);
		}
		samples[name] = values;
	}
	return samples;
}

class Sampler {
	constructor(private readonly document: ContractSchemaDocument) {}

	samplesOf(name: string): JsonValue[] {
		const schema = this.def(name);
		if (name === "JsonValue") return [SAMPLE_JSON, null, "text"];
		if (schema.enum) return schema.enum.map((value) => value);
		if (schema.oneOf) return schema.oneOf.flatMap((member) => this.samplesOf(this.refOf(member)));
		if (schema.type === "object" && schema.properties)
			return distinct([this.value(schema, "full"), this.value(schema, "minimal")]);
		return [this.value(schema, "full")];
	}

	private def(name: string): Schema {
		const schema = this.document.$defs[name];
		if (!schema) throw new Error(`no type ${name}`);
		return schema;
	}

	private value(schema: Schema, shape: Shape): JsonValue {
		if (schema.$ref) return this.refValue(refName(schema.$ref), shape);
		if (schema.const !== undefined) return schema.const;
		if (schema.enum) return first(schema.enum);
		if (schema.oneOf) return this.refValue(this.refOf(first(schema.oneOf)), shape);
		switch (schema.type) {
			case "string":
				return this.text(schema);
			case "integer":
				return Math.max(schema.minimum ?? 0, 1);
			case "number":
				return Math.max(schema.minimum ?? 0, 1.5);
			case "boolean":
				return shape === "full";
			case "array":
				return Array.from({ length: Math.max(schema.minItems ?? 0, 1) }, () =>
					this.value(this.only(schema.items), shape),
				);
			case "object":
				return schema.properties
					? this.object(schema, shape)
					: { key: this.value(this.only(schema.additionalProperties), shape) };
			default:
				throw new Error(`cannot sample ${JSON.stringify(schema)}`);
		}
	}

	private refValue(name: string, shape: Shape): JsonValue {
		if (name === "JsonValue") return SAMPLE_JSON;
		return this.value(this.def(name), shape);
	}

	private object(schema: Schema, shape: Shape): JsonValue {
		const required = new Set(schema.required ?? []);
		const result: { [key: string]: JsonValue } = {};
		for (const [key, property] of Object.entries(schema.properties ?? {})) {
			if (shape === "minimal" && !required.has(key)) continue;
			result[key] = this.value(this.only(property), shape);
		}
		return result;
	}

	private text(schema: Schema): string {
		if (schema.format === "uuid") return SAMPLE_UUID;
		if (schema.format === "base64") return SAMPLE_BASE64;
		if (schema.format === "uri") return SAMPLE_URL;
		const patterned = schema.pattern === undefined ? undefined : PATTERN_SAMPLES.get(schema.pattern);
		const text = patterned ?? "x".repeat(Math.max(schema.minLength ?? 0, 1));
		if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(text))
			throw new Error(`cannot sample the pattern ${schema.pattern}`);
		return text;
	}

	private refOf(member: Schema): string {
		if (!member.$ref) throw new Error(`a union member is not a named type: ${JSON.stringify(member)}`);
		return refName(member.$ref);
	}

	private only(value: Schema | boolean | (Schema | boolean)[] | undefined): Schema {
		if (value === undefined || typeof value === "boolean" || Array.isArray(value))
			throw new Error("expected one schema");
		return value;
	}
}

function first<T>(values: readonly T[]): T {
	const [value] = values;
	if (value === undefined) throw new Error("an empty enum or union");
	return value;
}

function distinct(values: JsonValue[]): JsonValue[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const key = JSON.stringify(value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
