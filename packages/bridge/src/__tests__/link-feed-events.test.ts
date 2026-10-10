/**
 * The daemon's feed driven by the same per-backend entry points the bridge itself calls: the busy
 * flag the machine-awake watch follows, and the three alert kinds.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiDurablePermissionRequest } from "../connectors/pi-durable";
import { broadcastPiDurablePermission } from "../handlers/pi_durable/transport";
import type { Broadcast } from "../handlers/pi_message_helpers";
import { broadcastPiStreamMessage } from "../handlers/pi_stream_bridge";
import { resetLinkFeed } from "../server/link-feed/feed";
import { createLeveledLogger } from "../server/logger";
import { createOpenCodeEvents } from "../server/opencode-events";
import { createBridgeState } from "../server/state";
import { createStreams } from "../server/streams";
import type { ClaudeCodeStreamMessage } from "../types/claude-code-stream-message";
import type { CodexStreamMessage } from "../types/codex";
import type { PiStreamMessage } from "../types/pi";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { alertsOf, busyFrame, DAEMON_HEADERS, finishFeed, openFeed, shortTiming } from "./link/feed-client";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const root = mkdtempSync(join(tmpdir(), "broski-link-feed-events-"));
const socketPath = join(root, "run", "link.sock");
const CWD = "/Users/dev/broski";

const log = createLeveledLogger({});
const state = createBridgeState({
	opencode: null,
	auth: { version: 1, token: "feed-test-token", createdAt: Date.now(), expiresAt: Date.now() + 60_000 },
	webDistDir: "/tmp",
	defaultAgent: "claude-code",
	logInfo: () => {},
});
const streams = createStreams({ state, log, debugRts: false });
const opencodeEvents = createOpenCodeEvents({
	state,
	streams,
	log,
	debugRts: false,
	requireOpenCode: () => {
		throw new Error("the feed tests never start an OpenCode server");
	},
	syncExternalTailForKey: () => {},
});
const broadcast: Broadcast = streams.broadcast;

let bridge: BridgeHandle;

beforeAll(async () => {
	// The tracker is process-wide, so earlier files' sessions must not colour this file's assertions.
	resetLinkFeed();
	bridge = await startBridge({ linkSocket: socketPath });
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	env.restore();
	rmSync(root, { recursive: true, force: true });
});

function ccStream(message: ClaudeCodeStreamMessage, sessionId: string, cwd?: string): void {
	if (cwd) state.ccSessionCwds.set(sessionId, cwd);
	streams.emitCcStream(sessionId, message);
}

function piStream(message: PiStreamMessage, sessionId: string): void {
	broadcastPiStreamMessage(broadcast, CWD, sessionId, message);
}

function cxStream(message: CodexStreamMessage, threadId: string): void {
	streams.emitCxStream(threadId, message);
}

function ocStream(payloadType: string, properties: Record<string, unknown>): void {
	opencodeEvents.enqueueSdkEvent({ directory: CWD, payload: { type: payloadType, properties } });
}

function durablePermission(sessionId: string, requestId: string): void {
	const request: PiDurablePermissionRequest = {
		requestId,
		sessionId,
		toolName: "bash",
		input: { command: "echo hi" },
		title: "Run bash",
	};
	broadcastPiDurablePermission(request);
}

describe("link feed busy state", () => {
	test("turns true at once and false only after the idle debounce", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			ccStream({ type: "session-created", sessionId: "cc-busy", agent: "claude-code" }, "cc-busy");
			expect((await busyFrame(feed, true)).busy).toBe(true);

			ccStream({ type: "result-complete", subtype: "success" }, "cc-busy");
			await expect(busyFrame(feed, false, 30)).rejects.toThrow("timeout waiting for busy=false");
			expect((await busyFrame(feed, false)).busy).toBe(false);
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("a feed connecting mid-turn is told at once", async () => {
		const restore = shortTiming();
		let feed: UnixWsClient | null = null;
		try {
			ccStream({ type: "session-created", sessionId: "cc-mid", agent: "claude-code" }, "cc-mid");
			feed = await connectUnixWs(socketPath, DAEMON_HEADERS);
			expect((await feed.waitFor("link_busy")).busy).toBe(true);
			ccStream({ type: "result-complete", subtype: "success" }, "cc-mid");
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("stays true while any backend works and clears once all are idle", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			ccStream({ type: "session-created", sessionId: "cc-any", agent: "claude-code" }, "cc-any");
			ocStream("session.status", { sessionID: "oc-any", status: { type: "busy" } });
			cxStream({ type: "notification", method: "turn/started", params: {} }, "cx-any");
			piStream({ type: "agent-start" }, "pi-any");
			expect((await busyFrame(feed, true)).busy).toBe(true);

			ccStream({ type: "result-complete", subtype: "success" }, "cc-any");
			ocStream("session.idle", { sessionID: "oc-any" });
			cxStream({ type: "notification", method: "turn/completed", params: {} }, "cx-any");
			piStream({ type: "agent-end", messages: [] }, "pi-any");
			expect((await busyFrame(feed, false)).busy).toBe(false);
		} finally {
			await finishFeed(feed, restore);
		}
	});
});

describe("link feed alerts", () => {
	test("an approval is emitted once per request id with a truncated single-line body", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			const request: ClaudeCodeStreamMessage = {
				type: "permission-request",
				sessionId: "cc-approval",
				toolUseId: "toolu-approval-1",
				tool: "Bash",
				input: { command: `rm -rf build\n${"a".repeat(400)}` },
			};
			ccStream(request, "cc-approval", CWD);
			ccStream(request, "cc-approval", CWD);

			const alerts = await alertsOf(feed, 1);
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "approval",
				backend: "claude-code",
				session: "cc-approval",
				cwd: "broski",
				title: "Claude Code needs approval",
			});
			const body = String(alerts[0]?.body);
			expect(body.startsWith("Bash: rm -rf build a")).toBe(true);
			expect(body.includes("\n")).toBe(false);
			expect(body.length).toBe(200);
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("a request whose id is missing is not mistaken for a repeat", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			ocStream("question.asked", { sessionID: "oc-no-id", title: "Pick one" });
			ocStream("question.asked", { sessionID: "oc-no-id", title: "Pick one" });
			expect(await alertsOf(feed, 2)).toHaveLength(2);
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("a user input request is emitted as attention", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			ocStream("question.asked", {
				id: "oc-q-1",
				sessionID: "oc-q",
				title: "Pick one",
				prompt: "Which environment?\nstaging or prod?",
			});

			const alerts = await alertsOf(feed, 1);
			expect(alerts[0]).toMatchObject({
				kind: "attention",
				backend: "opencode",
				session: "oc-q",
				cwd: "broski",
				title: "OpenCode needs input",
				body: "Which environment? staging or prod?",
			});
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("done carries the first line of the final answer after the flap window", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			piStream({ type: "turn-start" }, "pi-done");
			piStream({ type: "text-delta", content: "Fixed the bug.\nThen I ran the tests." }, "pi-done");
			piStream({ type: "turn-end", message: {}, toolResults: [] }, "pi-done");

			const alerts = await alertsOf(feed, 1);
			expect(alerts[0]).toMatchObject({
				kind: "done",
				backend: "pi",
				session: "pi-done",
				cwd: "broski",
				title: "Pi finished",
				body: "Fixed the bug.",
			});
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("no done is emitted when the session goes busy again inside the window", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			piStream({ type: "turn-start" }, "pi-flap");
			piStream({ type: "turn-end", message: {}, toolResults: [] }, "pi-flap");
			await Bun.sleep(30);
			piStream({ type: "turn-start" }, "pi-flap");
			await expect(
				feed.waitForWhere((frame) => frame.type === "link_event" && frame.session === "pi-flap", "done", 200),
			).rejects.toThrow("timeout waiting for done");

			piStream({ type: "turn-end", message: {}, toolResults: [] }, "pi-flap");
			expect((await alertsOf(feed, 1))[0]).toMatchObject({ kind: "done", session: "pi-flap" });
		} finally {
			await finishFeed(feed, restore);
		}
	});

	test("each backend's request event arrives as an alert that names it", async () => {
		const restore = shortTiming();
		const feed = await openFeed(socketPath);
		try {
			ccStream(
				{ type: "permission-request", sessionId: "cc-a", toolUseId: "cc-a-1", tool: "Bash", input: { command: "ls" } },
				"cc-a",
			);
			ocStream("permission.asked", { id: "oc-a-1", sessionID: "oc-a", permission: "bash", patterns: ["src/**"] });
			cxStream(
				{
					type: "request",
					requestId: "cx-a-1",
					method: "item/commandExecution/requestApproval",
					params: { command: "npm test" },
				},
				"cx-a",
			);
			durablePermission("pd-a", "pd-a-1");

			const alerts = await alertsOf(feed, 4);
			expect(alerts.map((alert) => [alert.backend, alert.kind, alert.body])).toEqual([
				["claude-code", "approval", "Bash: ls"],
				["opencode", "approval", "bash: src/**"],
				["codex", "approval", "requestApproval: npm test"],
				["pi-durable", "approval", "bash: echo hi"],
			]);
		} finally {
			await finishFeed(feed, restore);
		}
	});
});
