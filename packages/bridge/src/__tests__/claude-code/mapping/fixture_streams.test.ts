/**
 * All 21 recorded scenarios through the real mapper: every stream is valid under the contract's rules with the traits
 * Claude Code declares, nothing is open at rest, every event is a valid contract event, and no frame is touched.
 */

import { describe, expect, test } from "bun:test";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { deepFreeze, newMapper, play, schemaProblems, violationsOf } from "./helpers";

describe("the recorded scenarios", () => {
	test("there are 21 of them", () => {
		expect(frameScenarios()).toHaveLength(21);
	});

	for (const scenario of frameScenarios()) {
		describe(scenario, () => {
			test("every stream passes the contract's stream rules and is at rest", () => {
				expect(violationsOf(play(readFrameFixture(scenario)))).toEqual([]);
			});

			test("every event is a valid contract event", () => {
				expect(schemaProblems(play(readFrameFixture(scenario)))).toEqual([]);
			});

			test("frames are only read, never changed", () => {
				const frames = readFrameFixture(scenario).map((frame) => deepFreeze(frame));
				expect(() => play(frames, newMapper())).not.toThrow();
			});
		});
	}
});
