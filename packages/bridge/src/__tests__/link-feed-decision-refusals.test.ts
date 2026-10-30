/**
 * Decisions the daemon may not apply: an unknown backend or request, a repeat, a request that needs
 * an answer rather than a decision, and one sent from a socket that is not the feed.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type DecisionHarness, startDecisionHarness } from "./link/decision-harness";
import { openFeed } from "./link/feed-client";
import { connectUnixWs } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const OWNER_HEADERS = { "x-broski-role": "owner", "x-broski-device-id": "0123456789abcdef0123456789abcdef" };

let h: DecisionHarness;

beforeAll(async () => {
	h = await startDecisionHarness();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await h.stop();
});

describe("decisions that cannot be applied", () => {
	test("an unknown backend and a request the feed never announced are refused", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			expect(await h.decide(feed, { backend: "gpt", session: "s", request: "r", decision: "allow" })).toMatchObject({
				ok: false,
				error: "unknown backend",
			});
			expect(
				await h.decide(feed, { backend: "claude-code", session: "ghost", request: "ghost-1", decision: "allow" }),
			).toMatchObject({ ok: false, error: "unknown request" });
		} finally {
			feed.close();
		}
	});

	test("a request that needs an answer, not a decision, is refused with unsupported", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			h.ocStream("question.asked", {
				id: "oc-q-dec",
				sessionID: "oc-q-dec",
				title: "Pick one",
				prompt: "Which environment?",
			});
			await h.alertFor(feed, "opencode", "oc-q-dec");
			expect(
				await h.decide(feed, { backend: "opencode", session: "oc-q-dec", request: "oc-q-dec", decision: "allow" }),
			).toMatchObject({ ok: false, error: "unsupported" });

			h.ccStream(
				{
					type: "permission-request",
					sessionId: "cc-q-dec",
					toolUseId: "toolu-q",
					tool: "AskUserQuestion",
					input: { questions: [] },
				},
				"cc-q-dec",
			);
			await h.alertFor(feed, "claude-code", "cc-q-dec");
			expect(
				await h.decide(feed, { backend: "claude-code", session: "cc-q-dec", request: "toolu-q", decision: "allow" }),
			).toMatchObject({ ok: false, error: "unsupported" });
		} finally {
			feed.close();
		}
	});

	test("a second decision for the same request is refused", async () => {
		const feed = await openFeed(h.socketPath);
		try {
			h.ccStream(
				{
					type: "permission-request",
					sessionId: "cc-repeat",
					toolUseId: "toolu-repeat",
					tool: "Bash",
					input: { command: "ls" },
				},
				"cc-repeat",
			);
			await h.alertFor(feed, "claude-code", "cc-repeat");

			const input = {
				backend: "claude-code",
				session: "cc-repeat",
				request: "toolu-repeat",
				decision: "allow",
			} as const;
			expect(await h.decide(feed, input)).toMatchObject({ ok: true, error: null });
			expect(await h.decide(feed, input)).toMatchObject({ ok: false, error: "already answered" });
		} finally {
			feed.close();
		}
	});
});

describe("the decision privilege", () => {
	test("a device socket's link_decision is ignored like any unknown message", async () => {
		const feed = await openFeed(h.socketPath);
		const owner = await connectUnixWs(h.socketPath, OWNER_HEADERS);
		try {
			h.ccStream(
				{
					type: "permission-request",
					sessionId: "cc-owner",
					toolUseId: "toolu-owner",
					tool: "Bash",
					input: { command: "ls" },
				},
				"cc-owner",
			);
			await h.alertFor(feed, "claude-code", "cc-owner");

			owner.send({
				type: "link_decision",
				backend: "claude-code",
				session: "cc-owner",
				request: "toolu-owner",
				decision: "allow",
			});
			await expect(
				owner.waitForWhere((frame) => frame.type === "link_decision_result", "a decision result", 300),
			).rejects.toThrow("timeout waiting for a decision result");
			expect(await owner.waitFor("error")).toMatchObject({ message: "Unknown message type" });

			expect(
				await h.decide(feed, { backend: "claude-code", session: "cc-owner", request: "toolu-owner", decision: "deny" }),
			).toMatchObject({ ok: true, error: null });
		} finally {
			owner.close();
			feed.close();
		}
	});
});
