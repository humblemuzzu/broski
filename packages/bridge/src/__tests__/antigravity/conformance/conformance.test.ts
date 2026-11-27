/**
 * The conformance rules on the real `agy` on the developer's Gemini API key (`BROSKI_TEST_AGY=1`, `GEMINI_API_KEY`):
 * about 37 prompts, from the account's budget. A rule that fails prints the wire since it began and ends its turns
 * (`live/live-test.ts`).
 *   GEMINI_API_KEY=… BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/conformance/conformance.test.ts
 */

import { afterAll, describe } from "bun:test";
import { CONFORMANCE_RULES, checkRule } from "../../../contract/testing/conformance";
import { account } from "../live/account";
import { gated, LIVE, TURN_MS, testMs } from "../live/gate";
import { liveTest } from "../live/live-test";
import { antigravityConformanceKit } from "./driver";

/** The most prompts one rule sends: four runs for each of agy's two kinds of ask, in the interactions rule. */
const RULE_TURNS = 8;

describe.skipIf(!LIVE.runs)(gated("the Antigravity adapter against agy on a Gemini API key", LIVE), () => {
	const kit = antigravityConformanceKit(TURN_MS);
	afterAll(async () => {
		await kit.dispose();
		console.log(account.report());
	});
	for (const rule of CONFORMANCE_RULES) {
		liveTest(rule.name, () => checkRule(kit.factory, rule, TURN_MS), testMs(RULE_TURNS));
	}
});
