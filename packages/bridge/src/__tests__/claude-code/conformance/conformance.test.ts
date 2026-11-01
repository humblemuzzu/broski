import { afterEach, describe } from "bun:test";
import { runConformance } from "../../../contract/testing/run-conformance";
import { expectNoOrphans } from "../spike/rig/orphans";
import { claudeCodeConformanceKit } from "./driver";

/** A real CLI start is 0.2–3 s (08-spike Q1), so a rule gets far more than the fake's 2 s. */
const RULE_MS = 15_000;

/** Step 5 deletes this line, and the `describe.skip` below becomes `describe`, once the lanes' stubs are filled. */
const SKIPPED = "skipped until Step 5: the Claude Code adapter's lanes are typed stubs (STEP-3-INTERFACES.md §10)";

const kit = claudeCodeConformanceKit(RULE_MS);

describe.skip(SKIPPED, () => {
	expectNoOrphans();
	afterEach(() => kit.dispose());
	runConformance("claude-code", kit.factory, RULE_MS);
});
