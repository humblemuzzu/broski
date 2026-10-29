import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import {
	contractRegistry,
	JsonValue,
	MAX_JSON_DEPTH,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	namedSchemas,
	PROTOCOL_VERSION,
} from "../../src/contract";
import { byCodeUnits } from "./order";

export type Schema = JSONSchema.JSONSchema;

export interface ContractSchemaDocument {
	$schema: string;
	$id: string;
	title: string;
	"x-protocolVersion": { major: number; minor: number };
	$defs: Record<string, Schema>;
}

const DEFS_PREFIX = "#/$defs/";

/** `JsonValue` is checked by a walk in code (see json.ts); this is the same shape as JSON Schema describes it. */
const JSON_VALUE_SCHEMA: Schema = {
	description: `Any JSON nested at most ${MAX_JSON_DEPTH} deep.`,
	anyOf: [
		{ type: "null" },
		{ type: "boolean" },
		{ type: "number" },
		{ type: "string", maxLength: MAX_TEXT_CHARS },
		{ type: "array", maxItems: MAX_LIST_ITEMS, items: { $ref: `${DEFS_PREFIX}JsonValue` } },
		{
			type: "object",
			maxProperties: MAX_LIST_ITEMS,
			propertyNames: { type: "string", maxLength: MAX_NAME_CHARS },
			additionalProperties: { $ref: `${DEFS_PREFIX}JsonValue` },
		},
	],
};

/** One JSON Schema document holding every named contract type in `$defs`, each tagged with its module. */
export function contractSchemaDocument(): ContractSchemaDocument {
	const output = z.toJSONSchema(contractRegistry(), {
		target: "draft-2020-12",
		uri: (id) => `${DEFS_PREFIX}${id}`,
		unrepresentable: "any",
		override: (context) => {
			if (context.zodSchema === JsonValue) Object.assign(context.jsonSchema, JSON_VALUE_SCHEMA);
			else if (context.zodSchema._zod.def.type === "custom") throw new Error("only JsonValue may be a custom schema");
		},
	});
	const defs: Record<string, Schema> = {};
	for (const { id, module } of namedSchemas().sort((a, b) => byCodeUnits(a.id, b.id))) {
		const generated = output.schemas[id];
		if (!generated) throw new Error(`zod produced no JSON Schema for ${id}`);
		const { $schema: _dialect, ...schema } = generated;
		defs[id] = { "x-module": module, ...schema };
	}
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://broski.dev/contract.schema.json",
		title: "Broski backend contract",
		"x-protocolVersion": { major: PROTOCOL_VERSION.major, minor: PROTOCOL_VERSION.minor },
		$defs: defs,
	};
}

export function refName(ref: string): string {
	if (!ref.startsWith(DEFS_PREFIX)) throw new Error(`unexpected $ref ${ref}`);
	return ref.slice(DEFS_PREFIX.length);
}
