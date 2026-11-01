/**
 * The daemon's lock-screen decisions on the link socket: the request id an alert carries, and that allow and deny reach the handler the phone's own response message reaches.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type DecisionHarness, startDecisionHarness } from "./link/decision-harness";
import { openFeed } from "./link/feed-client";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const CWD = "/Users/dev/broski";

let h: DecisionHarness;

beforeAll(async () => {
	h = await startDecisionHarness();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await h.stop();
});

describe("the request id an alert carries", () => {
	test("is the id the phone's own response message uses", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			h.ccStream(
				{
					type: "permission-request",
					sessionId: "cc-id",
					toolUseId: "toolu-id-1",
					tool: "Bash",
					input: { command: "ls" },
				},
				"cc-id",
				CWD,
			);
			expect((await h.alertFor(feed, "claude-code", "cc-id")).request).toBe("toolu-id-1");
		} finally {
			feed.close();
		}
	});
});

describe("claude-code decisions", () => {
	test("allow and deny reach the hook the phone's own response reaches", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			const allow = h.postHook("cc-hook", {
				hook_event_name: "PreToolUse",
				session_id: "cc-dec-allow",
				tool_use_id: "toolu-allow",
				tool_name: "Bash",
				tool_input: { command: "ls" },
			});
			const allowAlert = await h.alertFor(feed, "claude-code", "cc-dec-allow");
			expect(allowAlert.request).toBe("toolu-allow");
			const allowResult = await h.decide(feed, {
				backend: "claude-code",
				session: "cc-dec-allow",
				request: "toolu-allow",
				decision: "allow",
			});
			expect(allowResult).toMatchObject({ ok: true, error: null });
			expect(await h.hookDecision(await allow)).toBe("allow");

			const deny = h.postHook("cc-hook", {
				hook_event_name: "PreToolUse",
				session_id: "cc-dec-deny",
				tool_use_id: "toolu-deny",
				tool_name: "Bash",
				tool_input: { command: "rm -rf build" },
			});
			await h.alertFor(feed, "claude-code", "cc-dec-deny");
			const denyResult = await h.decide(feed, {
				backend: "claude-code",
				session: "cc-dec-deny",
				request: "toolu-deny",
				decision: "deny",
			});
			expect(denyResult).toMatchObject({ ok: true, error: null });
			expect(await h.hookDecision(await deny)).toBe("deny");
		} finally {
			feed.close();
		}
	});
});
