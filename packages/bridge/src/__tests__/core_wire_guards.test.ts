import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type JsonValue,
	MAX_CLIENT_MESSAGE_VALUES,
	MAX_JSON_DEPTH,
	MAX_LIST_ITEMS,
	MAX_MESSAGE_BYTES,
	type SessionRef,
} from "../contract";
import { MAX_MESSAGE_DEPTH, shapeProblem } from "../core/message-shape";
import { promptInput, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const SESSION: SessionRef = { backend: "pi", sessionId: "s" };

function answer(reply: JsonValue): JsonValue {
	return { type: "interaction.answer", requestId: "r", session: SESSION, answer: { interactionId: "i", reply } };
}

/** `leaf` inside `levels` nested lists. */
function nested(levels: number, leaf: JsonValue): JsonValue {
	let value = leaf;
	for (let level = 0; level < levels; level++) value = [value];
	return value;
}

async function errorFor(client: TestClient, message: JsonValue): Promise<[string | undefined, string, string]> {
	client.clear();
	await client.sendFrame({ type: "contract", message });
	const [reply] = client.messages;
	if (reply?.type !== "error") throw new Error(`expected an error, got ${reply?.type}`);
	return [reply.requestId, reply.error.code, reply.error.message];
}

describe("the inbound guards before the schema", () => {
	test("a prompt with two million attachments is refused by the walk, before the schema checks any of them", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const input = { ...promptInput("x"), attachments: Array(2_000_000).fill(1) };
		expect(await errorFor(client, { type: "prompt", requestId: "big", session: SESSION, input })).toEqual([
			"big",
			"invalid_message",
			`a list holds 2000000 entries; at most ${MAX_LIST_ITEMS}`,
		]);
	});

	test("lists of lists whose every entry is wrong are refused by their number of values", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const answers = Array(MAX_LIST_ITEMS).fill({ questionId: "q", selected: Array(MAX_LIST_ITEMS).fill(1) });
		expect(await errorFor(client, answer({ kind: "questions", answers }))).toEqual([
			"r",
			"invalid_message",
			`the message holds more than ${MAX_CLIENT_MESSAGE_VALUES} values`,
		]);
	});

	test("an object with millions of keys is refused without listing them", () => {
		const values: { [key: string]: JsonValue } = {};
		for (let index = 0; index < 2_000_000; index++) values[`k${index}`] = index;
		expect(shapeProblem(answer({ kind: "form", values }))).toBe(`an object holds more than ${MAX_LIST_ITEMS} keys`);
	});

	test("every bound the walk keeps is one the contract keeps too: the largest legal message passes it", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const deepest = answer({
			kind: "tool_permission",
			optionId: "o",
			grantIds: [],
			editedInput: nested(MAX_JSON_DEPTH, 1),
		});
		const fullForm = Object.fromEntries(
			Array.from({ length: MAX_LIST_ITEMS }, (_, index) => [`k${index}`, { kind: "boolean", value: true }]),
		);
		const fullPrompt = {
			...promptInput("x"),
			mentions: Array.from({ length: MAX_LIST_ITEMS }, () => ({ kind: "file", path: "/a" })),
		};
		for (const message of [deepest, answer({ kind: "form", values: fullForm })]) {
			expect(shapeProblem(message)).toBeUndefined();
			expect((await errorFor(client, message)).slice(0, 2)).toEqual(["r", "not_attached"]);
		}
		expect(shapeProblem({ type: "prompt", requestId: "r", session: SESSION, input: fullPrompt })).toBeUndefined();
		const deeper = answer({
			kind: "tool_permission",
			optionId: "o",
			grantIds: [],
			editedInput: nested(MAX_JSON_DEPTH + 1, 1),
		});
		expect(shapeProblem(deeper)).toBe(`the message nests deeper than ${MAX_MESSAGE_DEPTH} levels`);
		expect(
			shapeProblem(answer({ kind: "form", values: { ...fullForm, extra: { kind: "boolean", value: true } } })),
		).toBe(`an object holds more than ${MAX_LIST_ITEMS} keys`);
	});

	test("the walk's depth and list bounds are exactly the deepest and longest the contract's ClientMessage allows", () => {
		const schema = JSON.parse(readFileSync(join(import.meta.dir, "../contract/contract.schema.json"), "utf8"));
		const defs: { [name: string]: { [key: string]: JsonValue } } = schema.$defs;
		let deepestContainer = 0;
		const lists: number[] = [];
		const records: string[] = [];
		const visit = (node: JsonValue, depth: number, path: string): void => {
			if (node === null || typeof node !== "object" || Array.isArray(node)) return;
			const ref = typeof node.$ref === "string" ? node.$ref.replace("#/$defs/", "") : undefined;
			if (ref === "JsonValue") {
				deepestContainer = Math.max(deepestContainer, depth + MAX_JSON_DEPTH - 1);
				return;
			}
			if (ref !== undefined) {
				visit(defs[ref] ?? null, depth, `${path}>${ref}`);
				return;
			}
			for (const key of ["anyOf", "oneOf", "allOf"]) {
				const members = node[key];
				if (Array.isArray(members)) for (const member of members) visit(member, depth, path);
			}
			if (node.type === "array") {
				deepestContainer = Math.max(deepestContainer, depth);
				lists.push(typeof node.maxItems === "number" ? node.maxItems : Number.POSITIVE_INFINITY);
				visit(node.items ?? null, depth + 1, `${path}[]`);
			}
			if (node.type === "object") {
				deepestContainer = Math.max(deepestContainer, depth);
				const properties = node.properties;
				if (properties && typeof properties === "object" && !Array.isArray(properties)) {
					for (const [key, value] of Object.entries(properties)) visit(value, depth + 1, `${path}.${key}`);
				}
				if (node.additionalProperties && typeof node.additionalProperties === "object") {
					records.push(path);
					visit(node.additionalProperties, depth + 1, `${path}{}`);
				}
			}
		};
		visit({ $ref: "#/$defs/ClientMessage" }, 0, "");
		expect(deepestContainer + 1).toBe(MAX_MESSAGE_DEPTH);
		expect(Math.max(...lists)).toBe(MAX_LIST_ITEMS);
		expect(records.map((path) => path.split(">").at(-1))).toEqual(["FormReply.values"]);
	});

	test("a frame larger than the contract's message bound is refused, with its requestId", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		client.clear();
		const input = promptInput("x".repeat(MAX_MESSAGE_BYTES));
		await client.sendFrame({
			type: "contract",
			message: { type: "prompt", requestId: "huge", session: SESSION, input },
		});
		expect(client.messages).toMatchObject([
			{
				type: "error",
				requestId: "huge",
				error: { code: "invalid_message", message: expect.stringContaining("bytes") },
			},
		]);
	});

	test("a frame the connection's rate limit refused is answered rate_limited and nothing else happens", async () => {
		const rig = await startCoreRig();
		const client = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		client.clear();
		client.refuseFrame({ type: "contract", message: { type: "session.attach", requestId: "busy", session } });
		client.refuseFrame({ type: "contract", message: { type: "no.such" } });
		expect(client.messages).toMatchObject([
			{ type: "error", requestId: "busy", error: { code: "rate_limited" } },
			{ type: "error", error: { code: "rate_limited" } },
		]);
		expect(rig.opens.opened).toEqual([]);
	});
});
