/**
 * The gate of every test that starts the real `agy` (opted in and on a Gemini API key, and never otherwise), and the
 * profile the tap starts it in, on agy 1.5.18's measured flags.
 */

import { describe, expect, test } from "bun:test";
import { gated, gateOf, NO_API_KEY } from "./live/gate";
import { agyProfile, namesPlan, tappedArgs } from "./live/profile";

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

	test("agy acp runs in the profile, its app data dir relative; agy --version as it is; nothing else", () => {
		const profile = agyProfile("/tmp/live/profile");
		expect(tappedArgs(["acp", "--process-per-session"], profile)).toEqual([
			"acp",
			"--process-per-session",
			"--gemini-dir",
			"/tmp/live/profile/.gemini",
			"--app-data-dir",
			"antigravity-cli",
		]);
		expect(tappedArgs(["--version"], profile)).toEqual(["--version"]);
		expect(() => tappedArgs(["-p", "hello"], profile)).toThrow("only as `agy acp` or `agy --version`");
		expect(profile.presenceDir).toBe("/tmp/live/profile/.gemini/antigravity-cli/presence");
	});

	test("an answer names a plan only by a tier: agy on a Gemini API key sends none", () => {
		expect(namesPlan({ sessionId: "s", _meta: null })).toBe(false);
		expect(namesPlan({ _meta: { antigravity: { tier: null } } })).toBe(false);
		expect(namesPlan({ _meta: { antigravity: { tier: "Pro plan" } } })).toBe(true);
	});
});
