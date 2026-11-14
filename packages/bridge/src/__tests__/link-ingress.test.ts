/**
 * The broski-link unix-socket ingress, exercised through a real WebSocket over a real socket file
 * on the real bridge server: handshake rejections, identity, caps, stale paths and shutdown.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseCli } from "../cli";
import { PROTOCOL_VERSION } from "../contract";
import { createLimits } from "../server/limits";
import { linkSendLimits } from "../server/link-send-policy";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { connectUnixWs, unixUpgradeStatus } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const DEVICE_ID = "0123456789abcdef0123456789abcdef";
const SECOND_DEVICE_ID = "fedcba9876543210fedcba9876543210";
const PIPELINE_DEVICE_ID = "aaaabbbbccccddddaaaabbbbccccdddd";
const VALID_HEADERS = {
	"x-broski-device-id": DEVICE_ID,
	"x-broski-device-name": "Link Phone",
	"x-broski-role": "owner",
};

const root = mkdtempSync(join(tmpdir(), "broski-link-"));
const socketPath = join(root, "run", "link.sock");
let bridge: BridgeHandle;

beforeAll(async () => {
	bridge = await startBridge({ linkSocket: socketPath });
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	env.restore();
	rmSync(root, { recursive: true, force: true });
});

/** A socket file whose listener is gone: the file is renamed away before the listener unlinks it. */
async function createStaleSocketFile(path: string): Promise<void> {
	mkdirSync(dirname(path), { recursive: true });
	const placeholder = `${path}.live`;
	const listener = createServer();
	await new Promise<void>((resolve) => listener.listen(placeholder, resolve));
	renameSync(placeholder, path);
	await new Promise<void>((resolve) => listener.close(() => resolve()));
}

describe("link socket permissions", () => {
	test("the socket file is owner-only and its parent directory is private", () => {
		expect(statSync(socketPath).isSocket()).toBe(true);
		expect(statSync(socketPath).mode & 0o777).toBe(0o600);
		expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
	});
});

describe("link socket handshake", () => {
	test("an owner upgrade with a valid device id connects", async () => {
		expect(await unixUpgradeStatus(socketPath, VALID_HEADERS)).toBe(101);
	});

	test("a missing device id is rejected with 400", async () => {
		expect(await unixUpgradeStatus(socketPath, { "x-broski-role": "owner" })).toBe(400);
	});

	test("a device id that is not 32 lowercase hex is rejected with 400", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...VALID_HEADERS, "x-broski-device-id": "not-a-device-id" })).toBe(
			400,
		);
		expect(
			await unixUpgradeStatus(socketPath, { ...VALID_HEADERS, "x-broski-device-id": DEVICE_ID.toUpperCase() }),
		).toBe(400);
	});

	test("a role other than owner is rejected with 403", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...VALID_HEADERS, "x-broski-role": "viewer" })).toBe(403);
	});

	test("a missing role is rejected with 403", async () => {
		expect(await unixUpgradeStatus(socketPath, { "x-broski-device-id": DEVICE_ID })).toBe(403);
	});

	test("a device name over 64 characters is rejected with 400", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...VALID_HEADERS, "x-broski-device-name": "n".repeat(65) })).toBe(400);
		expect(
			await unixUpgradeStatus(socketPath, {
				...VALID_HEADERS,
				"x-broski-device-id": SECOND_DEVICE_ID,
				"x-broski-device-name": "n".repeat(64),
			}),
		).toBe(101);
	});
});

describe("link socket CLI", () => {
	test("the socket path comes from --link-socket or BROSKI_LINK_SOCKET", () => {
		expect(parseCli(["node", "broski", "--link-socket", "/tmp/link.sock"], {}).linkSocket).toBe("/tmp/link.sock");
		expect(parseCli(["node", "broski"], { BROSKI_LINK_SOCKET: "/tmp/env.sock" }).linkSocket).toBe("/tmp/env.sock");
		expect(parseCli(["node", "broski"], {}).linkSocket).toBeUndefined();
	});
});

describe("link socket message pipeline", () => {
	test("a link client's frames reach the core, and it is answered with contract frames only", async () => {
		const client = await connectUnixWs(socketPath, { ...VALID_HEADERS, "x-broski-device-id": PIPELINE_DEVICE_ID });
		try {
			client.send({
				type: "contract",
				message: {
					type: "hello",
					requestId: "link-1",
					protocol: PROTOCOL_VERSION,
					client: { name: "link", version: "0" },
				},
			});
			const reply = await client.waitFor("contract");
			expect(reply.message).toMatchObject({ type: "hello.result", requestId: "link-1" });
			expect(client.frames().every((frame) => frame.type === "contract")).toBe(true);
		} finally {
			client.close();
		}
	});
});

describe("link socket cap", () => {
	test("the default link cap is 32", () => {
		expect(createLimits().linkMaxClients).toBe(32);
	});
	test("the link send window and message cap default to 32 MiB and 8 MiB", () => {
		const limits = createLimits();
		expect(limits.linkBackpressureLimitBytes).toBe(32 * 1024 * 1024);
		expect(limits.linkMessageLimitBytes).toBe(8 * 1024 * 1024);
		expect(linkSendLimits(limits)).toMatchObject({ kind: "link", maxPendingFrames: 32_768 });
	});

	test("both are clamped: 8..256 MiB for the window, 1..8 MiB for one message", () => {
		process.env.BROSKI_LINK_BACKPRESSURE_MB = "1";
		process.env.BROSKI_LINK_MESSAGE_MB = "64";
		try {
			const limits = createLimits();
			expect(limits.linkBackpressureLimitBytes).toBe(8 * 1024 * 1024);
			expect(limits.linkMessageLimitBytes).toBe(8 * 1024 * 1024);
		} finally {
			delete process.env.BROSKI_LINK_BACKPRESSURE_MB;
			delete process.env.BROSKI_LINK_MESSAGE_MB;
		}
	});

	test("link clients use the link cap, not the network client cap", async () => {
		process.env.BROSKI_MAX_CLIENTS = "1";
		process.env.BROSKI_LINK_MAX_CLIENTS = "2";
		const capRoot = mkdtempSync(join(tmpdir(), "broski-link-cap-"));
		const capSocketPath = join(capRoot, "run", "link.sock");
		const capped = await startBridge({ linkSocket: capSocketPath });
		try {
			const first = await connectUnixWs(capSocketPath, VALID_HEADERS);
			const second = await connectUnixWs(capSocketPath, {
				...VALID_HEADERS,
				"x-broski-device-id": SECOND_DEVICE_ID,
			});
			try {
				expect(capped.server.connections()).toBe(2);
				expect(await unixUpgradeStatus(capSocketPath, VALID_HEADERS)).toBe(429);
			} finally {
				first.close();
				second.close();
			}
		} finally {
			await capped.stop();
			delete process.env.BROSKI_MAX_CLIENTS;
			delete process.env.BROSKI_LINK_MAX_CLIENTS;
			rmSync(capRoot, { recursive: true, force: true });
		}
	});
});

describe("link socket stale paths", () => {
	test("a leftover socket file with no listener is replaced", async () => {
		const path = join(root, "stale", "link.sock");
		await createStaleSocketFile(path);
		const stale = await startBridge({ linkSocket: path });
		try {
			expect(await unixUpgradeStatus(path, VALID_HEADERS)).toBe(101);
		} finally {
			await stale.stop();
		}
	});

	test("a plain file at the socket path is replaced", async () => {
		const path = join(root, "plain", "link.sock");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "not a socket");
		const replaced = await startBridge({ linkSocket: path });
		try {
			expect(await unixUpgradeStatus(path, VALID_HEADERS)).toBe(101);
		} finally {
			await replaced.stop();
		}
	});

	test("a live server on the path fails startup with a clear error", async () => {
		const path = join(root, "live", "link.sock");
		mkdirSync(dirname(path), { recursive: true });
		const listener = Bun.serve({ unix: path, fetch: () => new Response("other") });
		try {
			await expect(startBridge({ linkSocket: path })).rejects.toThrow(`another bridge is already serving ${path}`);
		} finally {
			listener.stop(true);
		}
	});
});

describe("link socket shutdown", () => {
	test("stopping the bridge removes the socket file", async () => {
		const path = join(root, "shutdown", "link.sock");
		const temp = await startBridge({ linkSocket: path });
		await temp.stop();
		expect(existsSync(path)).toBe(false);
		await expect(unixUpgradeStatus(path, VALID_HEADERS)).rejects.toThrow();
	});
});
