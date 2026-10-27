/**
 * The listeners do not wait for OpenCode. A managed start takes about ten seconds, and the bridge
 * used to spend them not listening at all: a phone that connected in that window got nothing.
 *
 * Here the start is a promise nothing resolves until the test says so. Everything that does not need
 * OpenCode answers at once, and what does need it waits for the arrival — bounded, with the reason
 * when it never arrives.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeConnector } from "../connectors/opencode";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { makeClient } from "./fixtures/oc-connector-harness";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const root = mkdtempSync(join(tmpdir(), "broski-opencode-start-"));
const socketPath = join(root, "run", "link.sock");
const DEVICE_HEADERS = { "x-broski-device-id": "0123456789abcdef0123456789abcdef", "x-broski-role": "owner" };
const READY_TIMEOUT_MS = 150;

let bridge: BridgeHandle;

beforeAll(async () => {
	bridge = await startBridge({
		linkSocket: socketPath,
		opencode: null,
		opencodePending: true,
		opencodeReadyTimeoutMs: READY_TIMEOUT_MS,
	});
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	env.restore();
	rmSync(root, { recursive: true, force: true });
});

async function withClient(work: (client: UnixWsClient) => Promise<void>): Promise<void> {
	const client = await connectUnixWs(socketPath, DEVICE_HEADERS);
	try {
		await work(client);
	} finally {
		client.close();
	}
}

describe("while a managed OpenCode start is still running", () => {
	test("a link client is served at once by everything that does not need it", async () => {
		await withClient(async (client) => {
			const started = Date.now();
			client.send({ type: "list_devices", requestId: "startup-1" });
			const reply = await client.waitFor("devices");
			expect(reply.requestId).toBe("startup-1");
			expect(Date.now() - started).toBeLessThan(1000);
		});
	});

	test("a request that needs it waits for the start, then says it is still starting", async () => {
		await withClient(async (client) => {
			const started = Date.now();
			client.send({ type: "list_sessions", requestId: "startup-2" });
			const reply = await client.waitFor("error");
			expect(reply.requestId).toBe("startup-2");
			expect(reply.message).toBe("OpenCode unavailable: it is still starting");
			expect(Date.now() - started).toBeGreaterThanOrEqual(READY_TIMEOUT_MS);
		});
	});
});

describe("once the start settles", () => {
	test("a failed start reports the reason the machine gave", async () => {
		bridge.server.setOpenCode(null, "the opencode CLI is not on PATH");
		await withClient(async (client) => {
			client.send({ type: "list_sessions", requestId: "startup-3" });
			expect((await client.waitFor("error")).message).toBe("OpenCode unavailable: the opencode CLI is not on PATH");
		});
	});
});

describe("once OpenCode arrives", () => {
	test("the requests that needed it are answered without waiting any more", async () => {
		const connector = new OpenCodeConnector({
			baseUrl: "http://127.0.0.1:1",
			client: makeClient([]).client,
		});
		bridge.server.setOpenCode(connector);

		await withClient(async (client) => {
			client.send({ type: "list_sessions", requestId: "startup-4" });
			const reply = await client.waitForWhere(
				(frame) => frame.type === "sessions" || frame.type === "error",
				"a sessions reply",
			);
			expect(reply.type).toBe("sessions");
			expect(String(reply.message ?? "")).not.toContain("OpenCode unavailable");
		});
	});

	test("a client already connected is told when it lands", async () => {
		// Nothing else broadcasts a status after the one sent on open, so a status arriving after
		// the clear is the arrival's own.
		const connector = new OpenCodeConnector({
			baseUrl: "http://127.0.0.1:1",
			client: makeClient([]).client,
		});
		await withClient(async (client) => {
			client.send({ type: "list_devices", requestId: "startup-5" });
			await client.waitFor("devices");
			client.clear();

			bridge.server.setOpenCode(connector);

			const status = await client.waitFor("status");
			expect(status.data).toHaveProperty("backends");
		});
	});
});
