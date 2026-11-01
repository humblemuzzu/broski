import { describe, expect, test } from "bun:test";
import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk";
import { type FormRequest, type Interaction, MAX_TEXT_CHARS } from "../../../contract";
import { DeskRig, stillPending } from "./desk-rig";

const SERVER = "elicit";

function form(requestedSchema: Record<string, unknown>, extra: Partial<ElicitationRequest> = {}): ElicitationRequest {
	return { serverName: SERVER, message: "Tell me about you", mode: "form", requestedSchema, ...extra };
}

function formOf(interaction: Interaction): FormRequest {
	if (interaction.request.kind !== "form") throw new Error(`a ${interaction.request.kind} ask`);
	return interaction.request;
}

describe("a form elicitation", () => {
	test("the spike's one-field schema becomes a required text field and its answer the content", async () => {
		const rig = new DeskRig();
		const schema = { type: "object", properties: { name: { type: "string", title: "Name" } }, required: ["name"] };
		const ask = rig.elicit(form(schema, { message: "What is your name?" }));
		const interaction = rig.only();
		expect(interaction).toMatchObject({ title: "What is your name?", blocksRun: true });
		expect(formOf(interaction)).toEqual({
			kind: "form",
			server: SERVER,
			fields: [
				{
					kind: "string",
					key: "name",
					title: "Name",
					required: true,
					hidden: false,
					when: [],
					options: [],
					allowCustom: false,
				},
			],
		});
		expect(rig.answer(interaction, { kind: "form", values: { name: { kind: "text", value: "Ada" } } })).toEqual({
			status: "accepted",
		});
		expect(await ask.promise).toEqual({ action: "accept", content: { name: "Ada" } });
	});

	test("every flat property type has a field, in the schema's own order", async () => {
		const rig = new DeskRig();
		const schema = {
			type: "object",
			properties: {
				email: {
					type: "string",
					format: "email",
					minLength: 3,
					maxLength: 80,
					default: "a@b.co",
					description: "Where to write",
				},
				age: { type: "integer", minimum: 0.5, maximum: 120.5, default: 30 },
				score: { type: "number", minimum: -1, maximum: 1 },
				subscribe: { type: "boolean", default: true },
				color: { type: "string", enum: ["red", "blue"], enumNames: ["Red", "Blue"], default: "blue" },
				size: {
					type: "string",
					oneOf: [
						{ const: "s", title: "Small" },
						{ const: "l", title: "Large" },
					],
				},
				tags: {
					type: "array",
					items: { type: "string", enum: ["a", "b", "c"] },
					minItems: 1,
					maxItems: 2,
					default: ["a", "zz"],
				},
				toppings: { type: "array", items: { anyOf: [{ const: "x", title: "Extra" }], type: "string" } },
			},
			required: ["email", "age"],
		};
		const ask = rig.elicit(form(schema));
		const interaction = rig.only();
		const fields = formOf(interaction).fields;
		expect(fields.map((field) => `${field.kind}:${field.key}`)).toEqual([
			"string:email",
			"integer:age",
			"number:score",
			"boolean:subscribe",
			"string:color",
			"string:size",
			"multiselect:tags",
			"multiselect:toppings",
		]);
		expect(fields[0]).toMatchObject({
			format: "email",
			minLength: 3,
			maxLength: 80,
			defaultValue: "a@b.co",
			required: true,
		});
		expect(fields[1]).toMatchObject({ minimum: 1, maximum: 120, defaultValue: 30, required: true });
		expect(fields[4]).toMatchObject({
			options: [
				{ value: "red", label: "Red" },
				{ value: "blue", label: "Blue" },
			],
			defaultValue: "blue",
		});
		expect(fields[5]).toMatchObject({
			options: [
				{ value: "s", label: "Small" },
				{ value: "l", label: "Large" },
			],
		});
		expect(fields[6]).toMatchObject({ minItems: 1, maxItems: 2, defaultValue: ["a"] });
		const result = rig.answer(interaction, {
			kind: "form",
			values: {
				email: { kind: "text", value: "ada@example.com" },
				age: { kind: "number", value: 36 },
				subscribe: { kind: "boolean", value: false },
				tags: { kind: "choices", values: ["a", "c"] },
			},
		});
		expect(result).toEqual({ status: "accepted" });
		expect(await ask.promise).toEqual({
			action: "accept",
			content: { email: "ada@example.com", age: 36, subscribe: false, tags: ["a", "c"] },
		});
	});

	test("a property named __proto__ gets another key and its answer goes back under the server's name", async () => {
		const rig = new DeskRig();
		const schema = JSON.parse(
			'{"type":"object","properties":{"__proto__":{"type":"string"},"_proto_":{"type":"string"}}}',
		);
		const ask = rig.elicit(form(schema));
		const interaction = rig.only();
		const keys = formOf(interaction).fields.map((field) => field.key);
		expect(keys).toEqual(["_proto__", "_proto_"]);
		rig.answer(interaction, {
			kind: "form",
			values: { _proto__: { kind: "text", value: "x" }, _proto_: { kind: "text", value: "y" } },
		});
		const result = await ask.promise;
		const content = result?.action === "accept" ? result.content : undefined;
		expect(content && Object.hasOwn(content, "__proto__")).toBe(true);
		expect(Object.entries(content ?? {})).toEqual([
			["__proto__", "x"],
			["_proto_", "y"],
		]);
		expect(JSON.parse(JSON.stringify(content))).toBeDefined();
	});

	test("values the schema does not allow are refused before they reach the server", () => {
		const rig = new DeskRig();
		rig.elicit(form({ type: "object", properties: { age: { type: "integer", minimum: 0 } }, required: ["age"] }));
		const interaction = rig.only();
		const refuse = (values: Record<string, { kind: "number"; value: number }>) =>
			rig.answer(interaction, { kind: "form", values });
		expect(refuse({ age: { kind: "number", value: -1 } })).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(refuse({ age: { kind: "number", value: 1.5 } })).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(rig.answer(interaction, { kind: "form", values: {} })).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect(rig.pending()).toHaveLength(1);
	});
});

describe("an empty-schema elicitation", () => {
	test.each([
		["no schema", undefined],
		["no properties", { type: "object", properties: {} }],
	])("with %s is a confirm: yes accepts, no declines", async (_name, schema) => {
		const rig = new DeskRig();
		const yes = rig.elicit(form(schema ?? {}, schema === undefined ? { requestedSchema: undefined } : {}));
		expect(rig.only().request).toEqual({ kind: "confirm" });
		rig.answer(rig.only(), { kind: "confirm", confirmed: true });
		expect(await yes.promise).toEqual({ action: "accept", content: {} });
		const no = rig.elicit(form(schema ?? {}));
		const asked = rig.requested()[1];
		if (!asked) throw new Error("no second ask");
		rig.answer(asked, { kind: "confirm", confirmed: false });
		expect(await no.promise).toEqual({ action: "decline" });
	});
});

describe("a url elicitation", () => {
	const LINK = "https://example.invalid/consent";
	const url: ElicitationRequest = {
		serverName: SERVER,
		message: "Consent in the browser",
		mode: "url",
		url: LINK,
		elicitationId: "el-1",
	};

	test("is an external url that a person accepts", async () => {
		const rig = new DeskRig();
		const ask = rig.elicit(url);
		expect(rig.only().request).toEqual({ kind: "external_url", url: LINK, server: SERVER });
		rig.answer(rig.only(), { kind: "external_url" });
		expect(await ask.promise).toEqual({ action: "accept" });
	});

	test("the server's completion before any answer withdraws it, and a later answer is stale", async () => {
		const rig = new DeskRig();
		const ask = rig.elicit(url);
		const interaction = rig.only();
		rig.desk.elicitationComplete("el-1");
		expect(await ask.promise).toEqual({ action: "cancel" });
		expect(rig.resolved()).toEqual([{ interactionId: interaction.id, reason: "withdrawn" }]);
		expect(rig.answer(interaction, { kind: "external_url" })).toMatchObject({ rejection: { code: "stale" } });
		rig.desk.elicitationComplete("el-1");
		expect(rig.resolved()).toHaveLength(1);
	});

	test("the completion after an answer changes nothing", async () => {
		const rig = new DeskRig();
		const ask = rig.elicit(url);
		rig.answer(rig.only(), { kind: "external_url" });
		await ask.promise;
		rig.desk.elicitationComplete("el-1");
		expect(rig.resolved()).toEqual([{ interactionId: rig.only().id, reason: "answered" }]);
	});

	test("a link that is not http(s) is never offered to open", () => {
		const rig = new DeskRig();
		rig.elicit({ ...url, url: "javascript:alert(1)" });
		expect(rig.only().request.kind).toBe("confirm");
	});
});

describe("an elicitation the contract cannot show", () => {
	const nested = {
		type: "object",
		properties: { address: { type: "object", properties: { city: { type: "string" } } } },
	};

	test("is raised for a person to decline or dismiss, and is not declined by the bridge", async () => {
		const rig = new DeskRig();
		const ask = rig.elicit(form(nested, { message: "Where do you live?" }));
		const interaction = rig.only();
		expect(interaction.request).toEqual({ kind: "confirm" });
		expect(interaction.body).toContain("a form with fields the app cannot show");
		expect(interaction.body).toContain("Where do you live?");
		expect(await stillPending(ask.promise, 10)).toBe(true);
		rig.answer(interaction, { kind: "confirm", confirmed: true });
		expect(await ask.promise).toEqual({ action: "decline" });
	});

	test.each([
		["dismissing it", { kind: "confirm", confirmed: false }],
		["cancelling it", { kind: "cancel", stopRun: false }],
	] as const)("%s tells the server it was cancelled", async (_name, reply) => {
		const rig = new DeskRig();
		const ask = rig.elicit(form(nested));
		rig.answer(rig.only(), reply);
		expect(await ask.promise).toEqual({ action: "cancel" });
	});

	test.each([
		["an array of objects", { type: "object", properties: { rows: { type: "array", items: { type: "object" } } } }],
		["a reference", { type: "object", properties: { a: { $ref: "#/$defs/a" } } }],
		["a type list", { type: "object", properties: { a: { type: ["string", "null"] } } }],
		["an enum with no values", { type: "object", properties: { a: { type: "string", enum: [] } } }],
		["a schema that is not an object", { type: "array" }],
		["required names without properties", { type: "object", required: ["a"] }],
		["a required name no property defines", { type: "object", properties: { a: { type: "string" } }, required: ["b"] }],
	])("%s is raised as a decline-or-dismiss confirm", (_name, schema) => {
		const rig = new DeskRig();
		rig.elicit(form(schema));
		expect(rig.only().request).toEqual({ kind: "confirm" });
	});

	test("an oversized message cannot make an interaction the contract refuses", () => {
		const rig = new DeskRig();
		rig.elicit(form(nested, { message: "m".repeat(MAX_TEXT_CHARS) }));
		expect(rig.only().body?.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
	});
});

describe("a cancel of an elicitation", () => {
	test("tells the server it was cancelled and, when it stops the run, aborts it", async () => {
		const rig = new DeskRig();
		const ask = rig.elicit(form({ type: "object", properties: { a: { type: "string" } } }));
		rig.answer(rig.only(), { kind: "cancel", stopRun: true });
		expect(await ask.promise).toEqual({ action: "cancel" });
		expect(rig.aborts).toEqual(["abort"]);
	});
});
