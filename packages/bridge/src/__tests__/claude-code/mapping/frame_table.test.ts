/** Every `SDKMessage` variant is mapped or ignored on purpose, and the frames the CLI sends beyond them are ignored too. */

import { describe, expect, test } from "bun:test";
import { AgentEvent } from "../../../contract";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { FRAME_KINDS, type FrameKey, frameKey, UNDECLARED_FRAMES } from "./frame-kinds";
import { newMapper } from "./helpers";
import { SAMPLES } from "./samples";

const KEYS = Object.keys(FRAME_KINDS) as FrameKey[];

describe("the table of frame kinds", () => {
	test("covers 43 kinds: the 40 variants of SDKMessage, with a result in five subtypes and the system frames by subtype", () => {
		expect(KEYS).toHaveLength(43);
		expect(KEYS.filter((key) => key.startsWith("system/"))).toHaveLength(29);
		expect(KEYS.filter((key) => key.startsWith("result/"))).toHaveLength(5);
	});

	test("every kind says what it shows or why it is ignored", () => {
		for (const key of KEYS) {
			const entry = FRAME_KINDS[key];
			const sentence = "shows" in entry ? entry.shows : entry.ignored;
			expect(sentence.length).toBeGreaterThan(4);
		}
	});

	test("every kind has a sample frame of exactly that kind", () => {
		for (const key of KEYS) expect(frameKey(SAMPLES[key])).toBe(key);
	});

	test("an ignored kind shows nothing and does not throw", () => {
		for (const key of KEYS) {
			if (!("ignored" in FRAME_KINDS[key])) continue;
			expect(newMapper().map(SAMPLES[key])).toEqual([]);
		}
	});

	test("a kind that shows something never yields an event the contract refuses", () => {
		for (const key of KEYS) {
			for (const item of newMapper().map(SAMPLES[key])) expect(AgentEvent.safeParse(item.event).success).toBe(true);
		}
	});
});

describe("the recorded frames", () => {
	const kinds = new Set<string>();
	for (const scenario of frameScenarios()) for (const frame of readFrameFixture(scenario)) kinds.add(frameKey(frame));

	test("every kind in them is in the table or listed as undeclared", () => {
		const unknown = [...kinds].filter((kind) => !(kind in FRAME_KINDS) && !(kind in UNDECLARED_FRAMES));
		expect(unknown).toEqual([]);
	});

	test("the undeclared ones (command_lifecycle) show nothing", () => {
		const undeclared = [...kinds].filter((kind) => kind in UNDECLARED_FRAMES);
		expect(undeclared).toEqual(["command_lifecycle"]);
		for (const scenario of frameScenarios()) {
			for (const frame of readFrameFixture(scenario).filter(
				(candidate) => frameKey(candidate) === "command_lifecycle",
			)) {
				expect(newMapper().map(frame)).toEqual([]);
			}
		}
	});

	test("the undeclared frames sdk.mjs passes through are all ignored with a reason", () => {
		for (const reason of Object.values(UNDECLARED_FRAMES)) expect(reason.length).toBeGreaterThan(8);
	});
});
