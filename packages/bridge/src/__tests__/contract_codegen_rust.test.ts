import { describe, expect, test } from "bun:test";
import { contractConstants } from "../../scripts/contract-gen/constants";
import { contractSchemaDocument, type Schema } from "../../scripts/contract-gen/json-schema";
import { rustModels } from "../../scripts/contract-gen/rust-emit";
import { rustTypeRegistry } from "../../scripts/contract-gen/rust-registry";
import { typeModel } from "../../scripts/contract-gen/type-model";
import { PROTOCOL_VERSION } from "../contract/protocol";

const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const tag = (value: string): Schema => ({ type: "string", const: value });
const text: Schema = { type: "string" };

function object(properties: Record<string, Schema>, optional: string[] = [], module = "test"): Schema {
	return {
		"x-module": module,
		type: "object",
		properties,
		required: Object.keys(properties).filter((key) => !optional.includes(key)),
		additionalProperties: false,
	};
}

const union = (...members: string[]): Schema => ({ "x-module": "test", oneOf: members.map(ref) });
const enumOf = (...values: string[]): Schema => ({ "x-module": "test", type: "string", enum: values });

/** The Rust a set of named schemas becomes, all files joined. */
function rustOf(defs: Record<string, Schema>): string {
	const types = typeModel({ ...contractSchemaDocument(), $defs: defs });
	return [...rustModels(types, [], PROTOCOL_VERSION).values()].join("\n");
}

describe("the Rust models", () => {
	test("declare every type of the contract once, under its Rust name, and refer to the hand-written JsonValue", () => {
		const types = typeModel(contractSchemaDocument());
		const files = rustModels(types, contractConstants(), { major: 3, minor: 7 });
		const source = [...files.values()].join("\n");
		for (const type of types.values()) {
			const name = type.name === "Option" ? "ContractOption" : type.name;
			const declared = source.match(new RegExp(`^pub (struct|enum|type) ${name}\\b`, "gm")) ?? [];
			expect(declared.length).toBe(type.kind === "json" ? 0 : 1);
		}
		expect(files.get("constants.rs")).toContain("pub const MAX_TEXT_CHARS: usize = 1048576;\n");
		expect(files.get("constants.rs")).toContain("use super::ProtocolVersion;\n\npub const MAX_BACKENDS");
		expect(files.get("constants.rs")).toEndWith(
			"\npub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion { major: 3, minor: 7 };\n",
		);
		expect(source).toContain("pub input: Option<crate::JsonValue>,");
		const registry = rustTypeRegistry(types, contractConstants());
		expect(registry).toContain('    ("MAX_TEXT_CHARS", MAX_TEXT_CHARS),\n');
		expect(registry).toContain('visitor.plain::<ContractOption>("Option");');
		expect(registry).toContain('visitor.tagged::<ImageContent>("ImageContent");');
	});

	test("tag a union by its discriminator, with each member its own struct in every union it is in", () => {
		const source = rustOf({
			A: object({ kind: tag("a"), name: text }),
			B: object({ kind: tag("b-c") }),
			One: union("A", "B"),
			Two: union("A"),
		});
		expect(source).toContain(
			'#[serde(tag = "kind")]\npub enum One {\n    #[serde(rename = "a")]\n    A(A),\n    #[serde(rename = "b-c")]\n    BC(B),\n}\n',
		);
		expect(source).toContain('pub enum Two {\n    #[serde(rename = "a")]\n    A(A),\n}\n');
		expect(source).toContain('#[serde(rename_all = "camelCase", deny_unknown_fields)]\npub struct B {}\n');
		expect(source.match(/impl crate::Tagged for A \{/g)?.length).toBe(1);
	});

	test("write fields in snake_case, a keyword raw, an option absent, never null, and a lone member with its tag", () => {
		const source = rustOf({
			A: object({ kind: tag("a") }),
			U: union("A"),
			Holder: object(
				{ toolCallId: text, match: text, note: text, image: ref("A"), spare: ref("A"), input: ref("JsonValue") },
				["note", "spare", "input"],
			),
			JsonValue: { "x-module": "json" },
		});
		expect(source).toContain(
			"pub struct Holder {\n" +
				"    pub tool_call_id: String,\n" +
				"    pub r#match: String,\n" +
				'    #[serde(default, skip_serializing_if = "Option::is_none")]\n' +
				'    #[serde(deserialize_with = "crate::codec::present")]\n' +
				"    pub note: Option<String>,\n" +
				'    #[serde(with = "crate::tagged")]\n' +
				"    pub image: A,\n" +
				'    #[serde(default, skip_serializing_if = "Option::is_none")]\n' +
				'    #[serde(with = "crate::tagged::option")]\n' +
				"    pub spare: Option<A>,\n",
		);
	});

	test("refuse a member tagged twice: serde reads one discriminator", () => {
		const twice = { A: object({ kind: tag("a"), type: tag("x") }), B: object({ kind: tag("b"), type: tag("y") }) };
		expect(() => rustOf({ ...twice, U: union("A", "B") })).toThrow(/exactly one discriminator/);
	});

	test("refuse a shape that would lose a member's tag", () => {
		const member = { A: object({ kind: tag("a") }), U: union("A") };
		const list = object({ all: { type: "array", items: ref("A") } });
		expect(() => rustOf({ ...member, Holder: list })).toThrow(/loses its tag; hold its union/);
		const map = object({ all: { type: "object", additionalProperties: ref("A") } });
		expect(() => rustOf({ ...member, Holder: map })).toThrow(/loses its tag/);
		const alias: Schema = { "x-module": "test", ...ref("A") };
		expect(() => rustOf({ ...member, Alias: alias })).toThrow(/an alias of A loses its tag/);
	});

	test("rename a taken type name and refuse names Rust, Swift or Kotlin cannot take", () => {
		expect(rustOf({ Option: object({ value: text }) })).toContain("pub struct ContractOption {");
		const both = { Option: object({ value: text }), ContractOption: object({ value: text }) };
		expect(() => rustOf(both)).toThrow(/both the Rust type ContractOption/);
		expect(() => rustOf({ Holder: object({ self: text }) })).toThrow(/cannot be a Rust field/);
		expect(() => rustOf({ Holder: object({ tool_call: text }) })).toThrow(/camelCase/);
		expect(() => rustOf({ Mode: enumOf("a-b", "a_b") })).toThrow(/both AB/);
		expect(() => rustOf({ Mode: enumOf("companion") })).toThrow(/taken name/);
		expect(() => rustOf({ Holder: object({ value: text }, [], "serde") })).toThrow(/taken name/);
		expect(() => rustOf({ Holder: object({ value: text }, [], "constants") })).toThrow(/taken name/);
	});
});
