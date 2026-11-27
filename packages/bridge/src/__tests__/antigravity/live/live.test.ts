/**
 * The Antigravity backend on the user's own `agy` and Google sign-in (`BROSKI_TEST_AGY=1`; the terminal clash also
 * `BROSKI_TEST_AGY_TERMINAL=1`): what the frame-level tests cannot show without `agy`. Every suite is in this one file
 * so its tests run one after another in one process, and every prompt is taken from the account's budget
 * (`account.ts`): 22 prompts for the whole file, 24 with the terminal clash.
 *
 *   BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/live/live.test.ts
 */

import { afterAll, describe } from "bun:test";
import { account } from "./account";
import { capacitySuite } from "./capacity-suite";
import { LIVE, TERMINAL } from "./gate";
import { questionsSuite } from "./questions-suite";
import { sessionsSuite } from "./sessions-suite";
import { terminalSuite } from "./terminal-suite";
import { turnsSuite } from "./turns-suite";

describe.skipIf(!LIVE)("Antigravity on the user's real agy", () => {
	afterAll(() => console.log(account.report()));
	sessionsSuite();
	turnsSuite();
	questionsSuite();
	capacitySuite();
	describe.skipIf(!TERMINAL)("with a terminal agy", terminalSuite);
});
