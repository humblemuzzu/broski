/**
 * The conformance rules on the user's own `agy` (`BROSKI_TEST_AGY=1`): about 37 prompts, from the account's budget.
 *   BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/conformance/conformance.test.ts
 */

import { afterAll, describe } from "bun:test";
import { runConformance } from "../../../contract/testing/run-conformance";
import { account } from "../live/account";
import { LIVE } from "../live/gate";
import { antigravityConformanceKit } from "./driver";

/** A cold `agy acp`, then a real model's turn with a tool and an ask. */
const RULE_MS = 90_000;

describe.skipIf(!LIVE)("the Antigravity adapter against the user's real agy", () => {
	const kit = antigravityConformanceKit(RULE_MS);
	afterAll(async () => {
		await kit.dispose();
		console.log(account.report());
	});
	runConformance("antigravity", kit.factory, RULE_MS);
});
