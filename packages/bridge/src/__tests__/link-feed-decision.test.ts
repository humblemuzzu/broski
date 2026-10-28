/**
 * The daemon's lock-screen decisions on the link socket: the request id each backend's alert
 * carries, and that allow and deny reach the handler the phone's own response message reaches.
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
	test("is the id the phone's own response message uses, for every backend that asks", async () => {
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
			h.ocStream("permission.asked", { id: "oc-perm-1", sessionID: "oc-id", permission: "bash", patterns: ["src/**"] });
			h.cxStream(
				{
					type: "request",
					requestId: "cx-req-1",
					method: "item/commandExecution/requestApproval",
					params: { command: "npm test" },
				},
				"cx-id",
			);
			h.durablePermission("pd-id", "pd-id:call-1");

			expect((await h.alertFor(feed, "claude-code", "cc-id")).request).toBe("toolu-id-1");
			expect((await h.alertFor(feed, "opencode", "oc-id")).request).toBe("oc-perm-1");
			expect((await h.alertFor(feed, "codex", "cx-id")).request).toBe("cx-req-1");
			expect((await h.alertFor(feed, "pi-durable", "pd-id")).request).toBe("pd-id:call-1");
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

describe("opencode decisions", () => {
	test("allow and deny reach the connector's permission reply", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			h.ocStream("permission.asked", {
				id: "oc-dec-allow",
				sessionID: "oc-dec",
				permission: "bash",
				patterns: ["src/**"],
			});
			await h.alertFor(feed, "opencode", "oc-dec");
			const allow = await h.decide(feed, {
				backend: "opencode",
				session: "oc-dec",
				request: "oc-dec-allow",
				decision: "allow",
			});
			expect(allow).toMatchObject({ ok: true, error: null });
			expect(h.permissionReplies()).toHaveLength(1);
			expect(h.permissionReplies()[0]?.args[0]).toMatchObject({ requestID: "oc-dec-allow", reply: "once" });

			h.ocStream("permission.asked", {
				id: "oc-dec-deny",
				sessionID: "oc-dec",
				permission: "bash",
				patterns: ["src/**"],
			});
			await h.alertFor(feed, "opencode", "oc-dec");
			const deny = await h.decide(feed, {
				backend: "opencode",
				session: "oc-dec",
				request: "oc-dec-deny",
				decision: "deny",
			});
			expect(deny).toMatchObject({ ok: true, error: null });
			expect(h.permissionReplies()).toHaveLength(2);
			expect(h.permissionReplies()[1]?.args[0]).toMatchObject({ requestID: "oc-dec-deny", reply: "reject" });
		} finally {
			feed.close();
		}
	});
});
