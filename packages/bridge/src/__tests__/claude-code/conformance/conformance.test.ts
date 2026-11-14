import { afterEach, describe } from "bun:test";
import { runConformance } from "../../../contract/testing/run-conformance";
import { expectNoOrphans } from "../spike/rig/orphans";
import { claudeCodeConformanceKit } from "./driver";

/** A real CLI start is 0.2–3 s, so a rule gets far more than the fake's 2 s. */
const RULE_MS = 15_000;

const kit = claudeCodeConformanceKit(RULE_MS);

describe("the Claude Code adapter against the real CLI", () => {
	expectNoOrphans();
	afterEach(() => kit.dispose());
	runConformance("claude-code", kit.factory, RULE_MS);
});
