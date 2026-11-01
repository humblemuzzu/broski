/** The mapper takes whatever the CLI sends: it never throws, never emits what the contract refuses, and stays bounded. */

import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AgentEvent } from "../../../contract";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { assistant, text, toolResult, toolUse } from "./frames";
import { deepFreeze, newMapper } from "./helpers";

const REPLACEMENTS: readonly unknown[] = [
	null,
	undefined,
	0,
	-1,
	"",
	"x",
	[],
	{},
	[null],
	{ type: 5 },
	Number.NaN,
	true,
];

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The frame with one field, or one field of one of its fields, replaced. */
function mutations(source: SDKMessage): SDKMessage[] {
	const out: SDKMessage[] = [];
	const frame: unknown = source;
	if (!isBag(frame)) return out;
	const wrap = (bag: Bag): SDKMessage => JSON.parse(JSON.stringify(bag));
	for (const key of Object.keys(frame)) {
		for (const replacement of REPLACEMENTS) {
			out.push(wrap({ ...frame, [key]: replacement }));
			const inner = frame[key];
			if (!isBag(inner)) continue;
			for (const innerKey of Object.keys(inner)) {
				out.push(wrap({ ...frame, [key]: { ...inner, [innerKey]: replacement } }));
			}
		}
	}
	return out;
}

describe("frames of every shape", () => {
	test("a recorded frame with any field wrong never throws, and what is sent is valid", () => {
		let tried = 0;
		for (const scenario of frameScenarios()) {
			const frames = readFrameFixture(scenario);
			frames.forEach((frame, index) => {
				const mapper = newMapper();
				for (const warmUp of frames.slice(0, index)) mapper.map(warmUp);
				for (const mutated of mutations(frame)) {
					tried += 1;
					const sent = mapper.map(mutated);
					for (const item of sent) expect(AgentEvent.safeParse(item.event).success).toBe(true);
					expect(() => mapper.settle("aborted")).not.toThrow();
				}
			});
		}
		expect(tried).toBeGreaterThan(10_000);
	});

	test("a frame of a type nobody has heard of shows nothing", () => {
		const unknown = { type: "from_the_future", subtype: "x", uuid: "u", session_id: "s" };
		const mapper = newMapper();
		expect(mapper.map(JSON.parse(JSON.stringify(unknown)))).toEqual([]);
		expect(mapper.map(JSON.parse("{}"))).toEqual([]);
		expect(mapper.map(JSON.parse('{"type":"system"}'))).toEqual([]);
	});

	test("a fault inside the mapping is one warning, then silence, never a throw", () => {
		const booby = Object.defineProperty(assistant("msg_1", [text("a")]), "message", {
			get(): never {
				throw new Error("boom");
			},
		});
		const mapper = newMapper();
		const first = mapper.map(booby);
		expect(first.map((item) => item.event)).toEqual([
			{ type: "notice", level: "warning", text: "Part of what Claude Code sent could not be shown." },
		]);
		expect(mapper.map(booby)).toEqual([]);
		expect(mapper.map(assistant("msg_2", [text("fine")])).length).toBeGreaterThan(0);
	});

	test("frames that cannot be changed are read all the same", () => {
		const mapper = newMapper();
		for (const scenario of frameScenarios()) {
			for (const frame of readFrameFixture(scenario)) mapper.map(deepFreeze(frame));
		}
		expect(() => mapper.settle("completed")).not.toThrow();
	});
});

describe("bounded", () => {
	test("a long session of calls and messages stays fast and leaves nothing open", () => {
		const mapper = newMapper();
		const started = performance.now();
		for (let at = 0; at < 20_000; at += 1) {
			mapper.map(assistant(`msg_${at}`, [text("t"), toolUse(`toolu_${at}`, "Bash", { command: "ls" })]));
			mapper.map(toolResult(`toolu_${at}`, "out"));
			mapper.noteSend(`00000000-0000-4000-8000-${String(at).padStart(12, "0")}`);
		}
		expect(performance.now() - started).toBeLessThan(5_000);
		expect(mapper.settle("completed")).toEqual([]);
	});

	test("a tool id seen long ago can start again once forgotten, but one seen lately cannot", () => {
		const mapper = newMapper();
		mapper.map(assistant("msg_1", [toolUse("toolu_1", "Bash", {})]));
		mapper.map(toolResult("toolu_1", "r"));
		expect(mapper.map(assistant("msg_2", [toolUse("toolu_1", "Bash", {})]))).toEqual([]);
	});
});
