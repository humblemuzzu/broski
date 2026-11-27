/**
 * The conformance rules on the real `agy` on the developer's Gemini API key (`BROSKI_TEST_AGY=1`, `GEMINI_API_KEY`):
 * about 37 prompts, from the account's budget.
 *   GEMINI_API_KEY=… BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/conformance/conformance.test.ts
 */

import { afterAll, describe } from "bun:test";
import { runConformance } from "../../../contract/testing/run-conformance";
import { account } from "../live/account";
import { gated, LIVE } from "../live/gate";
import { antigravityConformanceKit } from "./driver";

/** A cold `agy acp`, then a real model's turn with a tool and an ask. */
const RULE_MS = 90_000;

describe.skipIf(!LIVE.runs)(gated("the Antigravity adapter against agy on a Gemini API key", LIVE), () => {
	const kit = antigravityConformanceKit(RULE_MS);
	afterAll(async () => {
		await kit.dispose();
		console.log(account.report());
	});
	runConformance("antigravity", kit.factory, RULE_MS);
});
