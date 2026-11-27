/**
 * The Antigravity backend on the real `agy` on the developer's Gemini API key, in a profile of its own
 * (`BROSKI_TEST_AGY=1` and `GEMINI_API_KEY`; the terminal clash also `BROSKI_TEST_AGY_TERMINAL=1`): what the
 * frame-level tests cannot show without `agy`. Every suite is in this one file so its tests run one after another in
 * one process, and every prompt is taken from the account's budget (`account.ts`): 23 prompts for the whole file, 25
 * with the terminal clash.
 *
 *   GEMINI_API_KEY=… BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/live/live.test.ts
 */

import { afterAll, describe } from "bun:test";
import { account } from "./account";
import { capacitySuite } from "./capacity-suite";
import { gated, LIVE, TERMINAL } from "./gate";
import { questionsSuite } from "./questions-suite";
import { sessionsSuite } from "./sessions-suite";
import { terminalSuite } from "./terminal-suite";
import { turnsSuite } from "./turns-suite";

describe.skipIf(!LIVE.runs)(gated("Antigravity on agy with a Gemini API key", LIVE), () => {
	afterAll(() => console.log(account.report()));
	sessionsSuite();
	turnsSuite();
	questionsSuite();
	capacitySuite();
	describe.skipIf(!TERMINAL.runs)(gated("with a terminal agy", TERMINAL), terminalSuite);
});
