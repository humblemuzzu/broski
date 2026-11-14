/**
 * The bridge link key: the daemon writes 32 random bytes to `~/.broski/link/bridge.key` at every
 * start and quotes them on every upgrade it makes to the bridge's unix socket, so a socket file
 * that another local process can reach is not the only thing standing between it and the bridge.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../contract";
import { LINK_KEY_HEADER, linkKeyMatches, readLinkKey } from "../server/link-key";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { connectUnixWs, unixUpgradeStatus } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const DEVICE_ID = "0123456789abcdef0123456789abcdef";
const DEVICE_HEADERS = { "x-broski-device-id": DEVICE_ID, "x-broski-role": "owner" };
const DAEMON_HEADERS = { "x-broski-role": "link-daemon" };

const root = mkdtempSync(join(tmpdir(), "broski-link-key-"));
const socketPath = join(root, "run", "link.sock");
const keyFile = join(root, "bridge.key");

const FIRST_KEY = randomBytes(32).toString("hex");
const SECOND_KEY = randomBytes(32).toString("hex");

function writeKey(hex: string): void {
	writeFileSync(keyFile, `${hex}\n`, { mode: 0o600 });
}

let bridge: BridgeHandle;
let unkeyed: BridgeHandle;

beforeAll(async () => {
	writeKey(FIRST_KEY);
	bridge = await startBridge({ linkSocket: socketPath, linkKeyFile: keyFile });
	unkeyed = await startBridge({ linkSocket: join(root, "dev", "link.sock") });
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	await unkeyed.stop();
	env.restore();
	rmSync(root, { recursive: true, force: true });
});

describe("the key file", () => {
	test("holds the daemon's 32 random bytes as hex", () => {
		writeKey(FIRST_KEY);
		expect(readLinkKey(keyFile)).toBe(FIRST_KEY);
	});

	test("is read case-insensitively, because hex has two spellings", () => {
		writeKey(FIRST_KEY.toUpperCase());
		expect(readLinkKey(keyFile)).toBe(FIRST_KEY);
		writeKey(FIRST_KEY);
	});

	test("a missing file reads as no key", () => {
		expect(readLinkKey(join(root, "absent.key"))).toBeNull();
	});

	test("a file that is not 32 bytes of hex reads as no key", () => {
		const short = join(root, "short.key");
		writeFileSync(short, "abcd");
		expect(readLinkKey(short)).toBeNull();
		writeFileSync(short, "z".repeat(64));
		expect(readLinkKey(short)).toBeNull();
	});
});

describe("the key comparison", () => {
	test("accepts the key the file holds and nothing else", () => {
		expect(linkKeyMatches(FIRST_KEY, FIRST_KEY)).toBe(true);
		expect(linkKeyMatches(FIRST_KEY, SECOND_KEY)).toBe(false);
		expect(linkKeyMatches(null, FIRST_KEY)).toBe(false);
		expect(linkKeyMatches("", FIRST_KEY)).toBe(false);
		expect(linkKeyMatches(FIRST_KEY.slice(0, 62), FIRST_KEY)).toBe(false);
	});

	test("tolerates the whitespace a header may carry", () => {
		expect(linkKeyMatches(` ${FIRST_KEY} `, FIRST_KEY)).toBe(true);
	});
});

describe("a keyed link socket", () => {
	test("an upgrade without the key is refused with 403", async () => {
		expect(await unixUpgradeStatus(socketPath, DEVICE_HEADERS)).toBe(403);
	});

	test("an upgrade with the wrong key is refused with 403", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: SECOND_KEY })).toBe(403);
	});

	test("an upgrade with a key of the wrong shape is refused with 403", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: "not-a-key" })).toBe(403);
	});

	test("an upgrade with the key connects", async () => {
		expect(await unixUpgradeStatus(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: FIRST_KEY })).toBe(101);
	});

	test("the daemon's own feed owes the key too", async () => {
		expect(await unixUpgradeStatus(socketPath, DAEMON_HEADERS)).toBe(403);
		expect(await unixUpgradeStatus(socketPath, { ...DAEMON_HEADERS, [LINK_KEY_HEADER]: FIRST_KEY })).toBe(101);
	});
});

describe("key rotation", () => {
	test("a rewritten key file applies to the next upgrade without a bridge restart", async () => {
		writeKey(SECOND_KEY);
		expect(await unixUpgradeStatus(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: FIRST_KEY })).toBe(403);
		expect(await unixUpgradeStatus(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: SECOND_KEY })).toBe(101);
		writeKey(FIRST_KEY);
	});

	test("a key file that goes missing fails closed rather than open", async () => {
		const path = join(root, "gated", "link.sock");
		const gone = join(root, "gone.key");
		writeKey(FIRST_KEY);
		const gated = await startBridge({ linkSocket: path, linkKeyFile: gone });
		try {
			expect(await unixUpgradeStatus(path, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: FIRST_KEY })).toBe(403);
		} finally {
			await gated.stop();
		}
	});
});

describe("a link socket started without a key file", () => {
	test("still accepts the daemon, because that is the dev case", async () => {
		expect(await unixUpgradeStatus(join(root, "dev", "link.sock"), DEVICE_HEADERS)).toBe(101);
	});
});

describe("the keyed socket is a client", () => {
	test("a keyed upgrade's frames reach the core", async () => {
		const client = await connectUnixWs(socketPath, { ...DEVICE_HEADERS, [LINK_KEY_HEADER]: FIRST_KEY });
		try {
			const hello = {
				type: "hello",
				requestId: "keyed-1",
				protocol: PROTOCOL_VERSION,
				client: { name: "k", version: "0" },
			};
			client.send({ type: "contract", message: hello });
			const reply = await client.waitFor("contract");
			expect(reply.message).toMatchObject({ type: "hello.result", requestId: "keyed-1" });
		} finally {
			client.close();
		}
	});
});
