import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { contractSchemaDocument, type Schema } from "../../scripts/contract-gen/json-schema";
import {
	AgentEvent,
	ClientMessage,
	JsonValue,
	MAX_IMAGE_CHARS,
	MAX_JSON_DEPTH,
	MAX_LIST_ITEMS,
	NativeIds,
	namedSchemas,
	PageRequest,
	PROTOCOL_VERSION,
	PromptInput,
	ServerMessage,
	SessionRef,
} from "../contract";

describe("the contract schemas", () => {
	test("refuse fields they do not define", () => {
		expect(SessionRef.safeParse({ backend: "pi", sessionId: "s" }).success).toBe(true);
		expect(SessionRef.safeParse({ backend: "pi", sessionId: "s", path: "/x" }).success).toBe(false);
	});

	test("refuse an unknown union tag and an unknown enum value", () => {
		expect(AgentEvent.safeParse({ type: "agent_started" }).success).toBe(false);
		expect(SessionRef.safeParse({ backend: "cursor", sessionId: "s" }).success).toBe(false);
	});

	test("key prompts by a UUID", () => {
		const prompt = { mode: "start", text: "hi", attachments: [], mentions: [] };
		expect(PromptInput.safeParse({ ...prompt, clientRequestId: crypto.randomUUID() }).success).toBe(true);
		expect(PromptInput.safeParse({ ...prompt, clientRequestId: "1" }).success).toBe(false);
	});

	test("bound a page between 1 and 200 items", () => {
		expect(PageRequest.safeParse({ limit: 200 }).success).toBe(true);
		expect(PageRequest.safeParse({ limit: 0 }).success).toBe(false);
		expect(PageRequest.safeParse({ limit: 201 }).success).toBe(false);
	});

	test("pair every request type with one response type of the same name, and nothing else", () => {
		const requests: string[] = ClientMessage.options.map((option) => option.shape.type.value);
		const results = ServerMessage.options
			.map((option) => option.shape.type.value)
			.flatMap((type) => (type.endsWith(".result") ? [type.slice(0, -".result".length)] : []));
		expect([...results].sort()).toEqual([...requests].sort());
		expect(new Set(requests).size).toBe(requests.length);
	});

	test("bound every string, list and map, so no value grows without limit", () => {
		const unbounded: string[] = [];
		const visit = (path: string, schema: Schema | boolean | undefined) => {
			if (schema === undefined || typeof schema === "boolean") return;
			const bounded =
				schema.type === "string"
					? schema.maxLength !== undefined ||
						schema.format === "uuid" ||
						schema.const !== undefined ||
						schema.enum !== undefined
					: schema.type === "array"
						? schema.maxItems !== undefined
						: schema.type === "object" && schema.properties === undefined
							? schema.propertyNames !== undefined
							: true;
			if (!bounded) unbounded.push(path);
			for (const [key, value] of Object.entries(schema.properties ?? {})) visit(`${path}.${key}`, value);
			if (!Array.isArray(schema.items)) visit(`${path}[]`, schema.items);
			if (schema.type === "object" && schema.properties === undefined) visit(`${path}{}`, schema.additionalProperties);
			for (const option of schema.anyOf ?? []) visit(`${path}|`, option);
		};
		for (const [name, schema] of Object.entries(contractSchemaDocument().$defs)) visit(name, schema);
		expect(unbounded).toEqual([]);
	});

	test("refuse JSON nested past the depth bound without exhausting the stack", () => {
		const nested = (depth: number): JsonValue => (depth === 0 ? 1 : [nested(depth - 1)]);
		expect(JsonValue.safeParse(nested(MAX_JSON_DEPTH)).success).toBe(true);
		expect(JsonValue.safeParse(nested(MAX_JSON_DEPTH + 1)).success).toBe(false);
		let deep: JsonValue = 1;
		for (let level = 0; level < 100_000; level++) deep = [deep];
		expect(JsonValue.safeParse(deep).success).toBe(false);
		expect(JsonValue.safeParse({ f: () => 1 }).success).toBe(false);
		expect(JsonValue.safeParse(Number.NaN).success).toBe(false);
	});

	test("refuse a map with more entries than a list may hold", () => {
		const many = Object.fromEntries(Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => [`k${index}`, "v"]));
		expect(NativeIds.safeParse(many).success).toBe(false);
		expect(JsonValue.safeParse(many).success).toBe(false);
		expect(NativeIds.safeParse({ k: "v" }).success).toBe(true);
	});

	test("refuse a prompt whose images together pass the image bound", () => {
		const image = { kind: "image", mimeType: "image/png", data: "A".repeat(MAX_IMAGE_CHARS / 2 + 1) } as const;
		const prompt = { clientRequestId: crypto.randomUUID(), mode: "start", text: "", mentions: [] } as const;
		expect(PromptInput.safeParse({ ...prompt, attachments: [image] }).success).toBe(true);
		expect(PromptInput.safeParse({ ...prompt, attachments: [image, image] }).success).toBe(false);
	});

	test("are each registered once, under the name they are exported as", () => {
		const named = namedSchemas();
		expect(new Set(named.map((entry) => entry.id)).size).toBe(named.length);
		expect(new Set(named.map((entry) => entry.schema)).size).toBe(named.length);
	});

	test("give every object and enum a name, so nothing is anonymous on the wire", () => {
		const registered = new Set<z.ZodType>(namedSchemas().map((entry) => entry.schema));
		const anonymous: string[] = [];
		for (const { id, schema } of namedSchemas()) {
			if (!(schema instanceof z.ZodObject)) continue;
			for (const [field, value] of Object.entries(schema.shape)) {
				const inner = value instanceof z.ZodOptional ? value.unwrap() : value;
				const isObject = inner instanceof z.ZodObject || inner instanceof z.ZodEnum;
				if (isObject && !registered.has(inner)) anonymous.push(`${id}.${field}`);
			}
		}
		expect(anonymous).toEqual([]);
	});

	test("version the protocol as major 1, minor 0", () => {
		expect(PROTOCOL_VERSION).toEqual({ major: 1, minor: 0 });
	});
});
