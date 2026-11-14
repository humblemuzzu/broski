/**
 * The daemon's feed on the link socket: identity, replacement, the health check, and the isolation
 * that keeps it out of the client world.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetLinkFeed } from "../server/link-feed/feed";
import { linkFeedTiming } from "../server/link-feed/tracker";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { connectFeed, DAEMON_HEADERS, openFeed, waitForClose } from "./link/feed-client";
import { connectUnixWs } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const root = mkdtempSync(join(tmpdir(), "broski-link-feed-"));
const socketPath = join(root, "run", "link.sock");
const DEVICE_ID = "0123456789abcdef0123456789abcdef";
const OWNER_HEADERS = { "x-broski-role": "owner", "x-broski-device-id": DEVICE_ID };

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

describe("link feed connection", () => {
	test("a feed connects with the daemon role and no device id, and is told the busy state", async () => {
		const feed = await connectUnixWs(socketPath, DAEMON_HEADERS);
		try {
			expect((await feed.waitFor("link_busy")).busy).toBe(false);
			await Bun.sleep(50);
			expect(feed.frames().map((frame) => frame.type)).toEqual(["link_busy"]);
		} finally {
			feed.close();
		}
	});

	test("a device id header on the daemon role is ignored", async () => {
		const messy = { ...DAEMON_HEADERS, "x-broski-device-id": "not-a-device-id", "x-broski-device-name": "x" };
		const feed = await connectUnixWs(socketPath, messy);
		try {
			expect((await feed.waitFor("link_busy")).busy).toBe(false);
		} finally {
			feed.close();
		}
	});

	test("a second feed replaces the first with 4001", async () => {
		const first = await openFeed(socketPath);
		const second = await openFeed(socketPath);
		try {
			expect((await waitForClose(first)).code).toBe(4001);
		} finally {
			first.close();
			second.close();
		}
	});

	test("the feed answers a ping and ignores every other message", async () => {
		const feed = await openFeed(socketPath);
		try {
			feed.send({ type: "link_feed_ping" });
			expect((await feed.waitFor("link_feed_pong")).type).toBe("link_feed_pong");

			feed.send({ type: "contract", message: { type: "backends.list", requestId: "feed-1" } });
			feed.send({ type: "link_feed_unknown" });
			await expect(feed.waitForWhere((frame) => frame.type !== "link_feed_pong", "a reply", 300)).rejects.toThrow(
				"timeout waiting for a reply",
			);
		} finally {
			feed.close();
		}
	});

	test("the feed is no client: it is not counted, and a client that leaves tells it nothing", async () => {
		const phone = await connectUnixWs(socketPath, OWNER_HEADERS);
		try {
			const clients = bridge.server.connections();
			const feed = await connectFeed(socketPath);
			try {
				expect(bridge.server.connections()).toBe(clients);
				phone.close();
				await expect(
					feed.waitForWhere((frame) => frame.type !== "link_busy", "a frame about the client", 400),
				).rejects.toThrow("timeout waiting for a frame about the client");
			} finally {
				feed.close();
			}
		} finally {
			phone.close();
		}
	});

	test("the machine-awake debounce is 3 s and the done window is 5 s", () => {
		expect(linkFeedTiming).toEqual({ busyIdleDebounceMs: 3000, doneIdleMs: 5000 });
	});
});
