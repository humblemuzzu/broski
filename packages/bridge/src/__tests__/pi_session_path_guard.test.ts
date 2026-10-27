/**
 * A phone may name the Pi transcript it wants to read, so the bridge keeps it naming one inside the
 * Pi sessions root: `..`, an absolute path elsewhere and a symlink out of the root are all refused.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chain, header } from "../../bench/lib/pi-synthetic-sessions";
import { piSessionsRoot, securePiSessionPath } from "../connectors/pi/pi-session-path";
import {
	type BridgeHandle,
	connect,
	E2E_TEST_TIMEOUT_MS,
	E2E_WAIT_MS,
	send,
	setupTestEnv,
	startBridge,
	writeJsonlSession,
} from "./e2e/harness";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const scratch = mkdtempSync(join(tmpdir(), "broski-pi-guard-"));
const root = join(scratch, "sessions");
const inside = join(root, "project", "session.jsonl");
const outside = join(scratch, "secret.txt");

let bridge: BridgeHandle;

beforeAll(async () => {
	mkdirSync(join(root, "project"), { recursive: true });
	writeFileSync(inside, "{}\n");
	writeFileSync(outside, "not a transcript\n");
	symlinkSync(outside, join(root, "escape.jsonl"));
	bridge = await startBridge();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	env.restore();
	rmSync(scratch, { recursive: true, force: true });
});

describe("securePiSessionPath", () => {
	test("accepts a file under the root", async () => {
		expect(await securePiSessionPath(inside, root)).toBe(realpathSync(inside));
	});

	test("refuses a file outside the root, named directly", async () => {
		expect(await securePiSessionPath(outside, root)).toBeNull();
	});

	test("refuses a traversal out of the root", async () => {
		expect(await securePiSessionPath(join(root, "..", "secret.txt"), root)).toBeNull();
		expect(await securePiSessionPath(`${root}/project/../../../secret.txt`, root)).toBeNull();
	});

	test("refuses a symlink that leaves the root", async () => {
		expect(await securePiSessionPath(join(root, "escape.jsonl"), root)).toBeNull();
	});

	test("refuses a directory", async () => {
		expect(await securePiSessionPath(join(root, "project"), root)).toBeNull();
	});

	test("a root that does not exist accepts nothing", async () => {
		expect(await securePiSessionPath(inside, join(scratch, "absent"))).toBeNull();
	});

	test("the default root is the agent's own sessions directory", async () => {
		expect(await piSessionsRoot()).toBe(join(env.piAgentDir, "sessions"));
	});
});

describe("pi_read_session_messages", () => {
	test("reads a transcript the phone names inside the sessions root", async () => {
		const sessionPath = writeJsonlSession(join(env.piAgentDir, "sessions", "guard"), "ok.jsonl", [
			header(2),
			...chain(2, "guard"),
		]);
		const client = await connect(bridge.port, bridge.token);
		try {
			await client.messages.waitFor("status");
			client.messages.clear();
			send(client.ws, { type: "pi_read_session_messages", sessionPath, requestId: "ok" });
			const reply = await client.messages.waitFor("pi_session_messages", E2E_WAIT_MS);
			expect((reply.data as unknown[]).length).toBeGreaterThan(0);
		} finally {
			client.ws.close();
		}
	});

	test("refuses a path outside the sessions root with an error, not an empty page", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			await client.messages.waitFor("status");
			client.messages.clear();
			send(client.ws, { type: "pi_read_session_messages", sessionPath: outside, requestId: "outside" });
			const reply = await client.messages.waitFor("error");
			expect(reply.message).toBe("Access denied");
			expect(reply.requestId).toBe("outside");
		} finally {
			client.ws.close();
		}
	});

	test("refuses a traversal out of the sessions root", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			await client.messages.waitFor("status");
			client.messages.clear();
			const sneaky = join(env.piAgentDir, "sessions", "..", "..", "hosts");
			send(client.ws, { type: "pi_read_session_messages", sessionPath: sneaky, requestId: "sneaky" });
			expect((await client.messages.waitFor("error")).message).toBe("Access denied");
		} finally {
			client.ws.close();
		}
	});
});
