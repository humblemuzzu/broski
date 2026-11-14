import { describe, expect, test } from "bun:test";
import {
	type ContractSchemaDocument,
	contractSchemaDocument,
	type Schema,
} from "../../scripts/contract-gen/json-schema";
import { byCodeUnits } from "../../scripts/contract-gen/order";
import { contractSamples } from "../../scripts/contract-gen/samples";
import { tagValue, typeModel } from "../../scripts/contract-gen/type-model";
import type { JsonValue } from "../contract";

function documentOf(defs: Record<string, Schema>): ContractSchemaDocument {
	return { ...contractSchemaDocument(), $defs: defs };
}

const strictObject = (properties: Schema["properties"], required: string[]): Schema => ({
	"x-module": "test",
	type: "object",
	properties,
	required,
	additionalProperties: false,
});

describe("the type model", () => {
	test("accepts the whole contract", () => {
		const types = typeModel(contractSchemaDocument());
		expect(types.get("AgentEvent")).toMatchObject({ kind: "union", key: "type" });
		expect(types.get("SessionRef")).toMatchObject({ kind: "class" });
		expect(types.get("BackendId")).toMatchObject({ kind: "enum" });
		expect(types.get("RunId")).toMatchObject({ kind: "alias", target: { kind: "string" } });
	});

	test("refuses an anonymous object, an anonymous enum and a null", () => {
		const inline = strictObject({ nested: { type: "object", properties: {}, additionalProperties: false } }, [
			"nested",
		]);
		expect(() => typeModel(documentOf({ Holder: inline }))).toThrow(/name this object/);
		const enumField = strictObject({ mode: { type: "string", enum: ["a", "b"] } }, ["mode"]);
		expect(() => typeModel(documentOf({ Holder: enumField }))).toThrow(/name this type/);
		const nullable = strictObject({ value: { anyOf: [{ type: "string" }, { type: "null" }] } }, ["value"]);
		expect(() => typeModel(documentOf({ Holder: nullable }))).toThrow(/name this type/);
	});

	test("refuses an object that accepts unknown fields", () => {
		const loose: Schema = {
			"x-module": "test",
			type: "object",
			properties: { a: { type: "string" } },
			required: ["a"],
		};
		expect(() => typeModel(documentOf({ Loose: loose }))).toThrow(/strict/);
	});

	test("refuses a union whose members no tag tells apart", () => {
		const member = strictObject({ kind: { type: "string", const: "same" } }, ["kind"]);
		const union: Schema = { "x-module": "test", oneOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/B" }] };
		expect(() => typeModel(documentOf({ A: member, B: member, U: union }))).toThrow(/no tag tells/);
	});
});

describe("generated order", () => {
	test("follows code units, not the locale", () => {
		expect(["b", "B", "a", "_", "é"].sort(byCodeUnits)).toEqual(["B", "_", "a", "b", "é"]);
	});
});

function tagOf(sample: JsonValue, key: string): JsonValue | undefined {
	return sample !== null && typeof sample === "object" && !Array.isArray(sample) ? sample[key] : undefined;
}

describe("the samples", () => {
	test("cover every union member and every enum value", () => {
		const document = contractSchemaDocument();
		const samples = contractSamples(document);
		for (const type of typeModel(document).values()) {
			const values = samples[type.name] ?? [];
			if (type.kind === "enum") expect(values).toEqual(type.values);
			if (type.kind !== "union") continue;
			const tags = new Set(values.map((sample) => tagOf(sample, type.key)));
			for (const member of type.members) {
				const memberType = typeModel(document).get(member);
				if (memberType?.kind !== "class") throw new Error(`${member} is not a class`);
				expect(tags.has(tagValue(memberType, type.key))).toBe(true);
			}
		}
	});
});
