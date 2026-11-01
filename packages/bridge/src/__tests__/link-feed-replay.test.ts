/**
 * What the daemon sees when its feed redials: the alerts still waiting for a decision are announced
 * again, exactly as they first went out, and the ones already answered stay closed.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type DecisionHarness, startDecisionHarness } from "./link/decision-harness";
import { DAEMON_HEADERS } from "./link/feed-client";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const CWD = "/Users/dev/broski";

let h: DecisionHarness;

beforeAll(async () => {
	h = await startDecisionHarness();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await h.stop();
});

/**
 * A feed as the daemon opens one, with nothing dropped: an alert replayed on attach arrives in the
 * same burst as `link_busy`, so a helper that cleared the buffer would throw the replay away.
 */
async function attachFeed(): Promise<UnixWsClient> {
	const feed = await connectUnixWs(h.socketPath, DAEMON_HEADERS);
	await feed.waitFor("link_busy");
	return feed;
}

async function alertOn(feed: UnixWsClient, session: string): Promise<Record<string, unknown>> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const found = feed.frames().find((frame) => frame.type === "link_event" && frame.session === session);
		if (found) return found;
		await Bun.sleep(10);
	}
	throw new Error(`no alert for ${session}`);
}

function alertsOn(feed: UnixWsClient, session: string): Array<Record<string, unknown>> {
	return feed.frames().filter((frame) => frame.type === "link_event" && frame.session === session);
}

async function settle(): Promise<void> {
	await Bun.sleep(150);
}

describe("a feed that attaches after an approval was announced", () => {
	let hook: Promise<Response> | undefined;

	test("is told the busy state and then the alert, unchanged", async () => {
		const first = await attachFeed();
		let announced: Record<string, unknown>;
		try {
			hook = h.postHook("cc-hook", {
				hook_event_name: "PreToolUse",
				session_id: "cc-hook-replay",
				tool_use_id: "toolu-hook-replay",
				tool_name: "Bash",
				tool_input: { command: "ls" },
			});
			announced = await alertOn(first, "cc-hook-replay");
		} finally {
			first.close();
		}

		const second = await attachFeed();
		try {
			const replayed = await alertOn(second, "cc-hook-replay");
			expect(replayed).toEqual(announced);
			expect(second.frames().map((frame) => frame.type)).toEqual(["link_busy", "link_event"]);
		} finally {
			second.close();
		}
	});

	test("a replayed alert is still answerable", async () => {
		const feed = await attachFeed();
		try {
			const alert = await alertOn(feed, "cc-hook-replay");
			feed.clear();
			feed.send({
				type: "link_decision",
				backend: "claude-code",
				session: "cc-hook-replay",
				request: String(alert.request),
				decision: "allow",
			});
			const result = await feed.waitForWhere(
				(frame) => frame.type === "link_decision_result" && frame.request === alert.request,
				"link_decision_result",
			);
			expect(result.ok).toBe(true);
			expect(await h.hookDecision(await (hook as Promise<Response>))).toBe("allow");
		} finally {
			feed.close();
		}
	});

	test("an answered approval is not announced a third time", async () => {
		const feed = await attachFeed();
		try {
			await settle();
			expect(alertsOn(feed, "cc-hook-replay")).toEqual([]);
		} finally {
			feed.close();
		}
	});
});

describe("an alert announced with no feed attached", () => {
	test("reaches the feed that attaches next", async () => {
		h.ccStream(
			{
				type: "permission-request",
				sessionId: "cc-replay",
				toolUseId: "toolu-replay-1",
				tool: "Bash",
				input: { command: "ls" },
			},
			"cc-replay",
			CWD,
		);
		const feed = await attachFeed();
		try {
			const alert = await alertOn(feed, "cc-replay");
			expect(alert.request).toBe("toolu-replay-1");
			expect(alert.kind).toBe("approval");
		} finally {
			feed.close();
		}
	});

	test("a user-input request is replayed as attention", async () => {
		h.inputRequest("cc-replay-q", { requestId: "cc-replay-q-1", title: "Pick one", prompt: "Which?" });
		const feed = await attachFeed();
		try {
			const alert = await alertOn(feed, "cc-replay-q");
			expect(alert.kind).toBe("attention");
			expect(alert.body).toBe("Which?");
		} finally {
			feed.close();
		}
	});
});
