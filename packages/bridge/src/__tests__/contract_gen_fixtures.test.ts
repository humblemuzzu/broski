import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../../scripts/contract-gen/canonical-json";
import { contractConstants, dartConstantName } from "../../scripts/contract-gen/constants";
import { DartCodec } from "../../scripts/contract-gen/dart-codec";
import { sharedFields } from "../../scripts/contract-gen/dart-union";
import { compactLongStrings, expandLongStrings, RUNS_KEY } from "../../scripts/contract-gen/fixture-text";
import { contractSchemaDocument } from "../../scripts/contract-gen/json-schema";
import { typeModel } from "../../scripts/contract-gen/type-model";

describe("long strings in fixtures", () => {
	test("are written as code-point runs and expand back exactly", () => {
		const text = `${"😀".repeat(3000)}\ud83d${"a".repeat(2000)}`;
		const compacted = compactLongStrings({ text, short: "x" });
		expect(compacted).toEqual({
			text: {
				[RUNS_KEY]: [
					["😀", 3000],
					["\ud83d", 1],
					["a", 2000],
				],
			},
			short: "x",
		});
		expect(expandLongStrings(compacted)).toEqual({ text, short: "x" });
	});

	test("refuse a value that already uses the runs key", () => {
		expect(() => compactLongStrings({ [RUNS_KEY]: [] })).toThrow();
	});
});

describe("canonical JSON", () => {
	test("orders every key by code units, integer-like keys too, at any depth", () => {
		const value = { "10": 1, "2": [{ z: 1, Z: null }], a: { é: true, b: "x" } };
		expect(canonicalJson(value)).toBe('{"10":1,"2":[{"Z":null,"z":1}],"a":{"b":"x","é":true}}');
	});
});

describe("generated constants", () => {
	test("name every bound, the page bound and the core's request deadline", () => {
		const names = contractConstants().map(([name]) => dartConstantName(name));
		expect(names).toContain("contractMaxTextChars");
		expect(names).toContain("contractMaxPageLimit");
		expect(names).toContain("contractRequestDeadlineMs");
	});

	test("refuse a name that is not SCREAMING_CASE", () => {
		expect(() => dartConstantName("maxText")).toThrow();
	});
});

describe("union getters", () => {
	const types = typeModel(contractSchemaDocument());
	const codec = new DartCodec(types);
	const shared = (name: string) => {
		const union = types.get(name);
		if (union?.kind !== "union") throw new Error(`${name} is not a union`);
		return sharedFields(union, types, codec).map((field) => `${field.type} ${field.name}`);
	};

	test("are the fields every member has with one type", () => {
		expect(shared("TranscriptItem")).toEqual(["TranscriptItemId id", "Timestamp? at"]);
		expect(shared("ClientMessage")).toEqual(["RequestId requestId"]);
		expect(shared("FormFieldSpec")).toContain("FieldKey key");
	});

	test("leave out a field whose type differs between members", () => {
		expect(shared("BackendCall")).toEqual([]);
		expect(shared("ServerMessage")).toEqual([]);
	});
});
