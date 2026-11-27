/** The gate of every test that starts the real `agy`: opted in and on a Gemini API key, and never otherwise. */

import { describe, expect, test } from "bun:test";
import { gated, gateOf, NO_API_KEY } from "./live/gate";

describe("the live gate", () => {
	test("starts agy only when opted in with a Gemini API key, and names why it does not", () => {
		const optIn = "opt-in: BROSKI_TEST_AGY=1 with GEMINI_API_KEY set";
		expect(gateOf("BROSKI_TEST_AGY", { GEMINI_API_KEY: "key" })).toEqual({ runs: false, why: optIn });
		expect(gateOf("BROSKI_TEST_AGY", { BROSKI_TEST_AGY: "1" })).toEqual({ runs: false, why: NO_API_KEY });
		expect(gateOf("BROSKI_TEST_AGY", { BROSKI_TEST_AGY: "1", GEMINI_API_KEY: " " })).toEqual({
			runs: false,
			why: NO_API_KEY,
		});
		expect(gateOf("BROSKI_AGY_RECORD", { BROSKI_AGY_RECORD: "1", GEMINI_API_KEY: "key" })).toEqual({
			runs: true,
			why: "",
		});
		expect(gated("the suite", { runs: false, why: NO_API_KEY })).toBe(`the suite (skipped: ${NO_API_KEY})`);
	});
});
