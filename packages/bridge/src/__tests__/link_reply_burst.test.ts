/**
 * An app that reconnects can have a pile of requests waiting; the bridge answers them all at once while the
 * daemon, whose own gate stops it reading once the phone's window is full, is not reading. The replies
 * together are far more than the 32 MiB a link socket may buffer, and every one of them must still arrive.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BridgeHandle, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge, type TestEnv } from "./e2e/harness";
import { connectUnixWs, type LinkFrame, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const DIFF_LINES = 40_000;
const REQUESTS = 16;
const LINK_WINDOW_BYTES = 32 * 1024 * 1024;
/** Long enough for the bridge to answer every request while the client reads nothing. */
const PRODUCE_WHILE_UNREAD_MS = 1500;

const DEVICE_HEADERS = {
	"x-broski-device-id": "0123456789abcdef0123456789abcdef",
	"x-broski-device-name": "Burst Phone",
	"x-broski-role": "owner",
};

let env: TestEnv | null = null;
let bridge: BridgeHandle | null = null;
let client: UnixWsClient | null = null;

afterEach(async () => {
	client?.close();
	await bridge?.stop();
	env?.restore();
	client = null;
	bridge = null;
	env = null;
});

function framesIn(frame: LinkFrame): LinkFrame[] {
	return frame.type === "batch" ? (frame.messages as LinkFrame[]) : [frame];
}

/** A repository whose working tree differs from its last commit by one large file. */
function repoWithLargeDiff(home: string): string {
	const repo = join(home, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "burst@test.invalid");
	git("config", "user.name", "Burst");
	writeFileSync(join(repo, "large.txt"), "start\n");
	git("add", "large.txt");
	git("commit", "-q", "-m", "start");
	const lines = Array.from({ length: DIFF_LINES }, (_, index) => `line ${index} ${"x".repeat(64)}`);
	writeFileSync(join(repo, "large.txt"), `${lines.join("\n")}\n`);
	return repo;
}

describe("a burst of large replies to a link client", () => {
	test("arrives whole although the client is not reading while it is produced", async () => {
		env = setupTestEnv();
		const home = realpathSync(env.home);
		const repo = repoWithLargeDiff(home);
		const socketPath = join(home, "link.sock");
		bridge = await startBridge({ linkSocket: socketPath });
		client = await connectUnixWs(socketPath, DEVICE_HEADERS);

		const ids = Array.from({ length: REQUESTS }, (_, index) => `burst-${index}`);
		const reader = client;
		reader.pause();
		for (const requestId of ids) reader.send({ type: "git_diff", projectPath: repo, requestId });
		await Bun.sleep(PRODUCE_WHILE_UNREAD_MS);
		reader.resume();

		for (const requestId of ids) {
			await reader.waitForWhere(
				(frame) => framesIn(frame).some((message) => message.requestId === requestId),
				`the reply to ${requestId}`,
				20_000,
			);
		}
		const replies = reader
			.frames()
			.flatMap(framesIn)
			.filter((message) => message.type === "git_diff");
		const replyBytes = replies.reduce((total, message) => total + JSON.stringify(message).length, 0);
		expect(reader.closed()).toBeNull();
		expect(replies.map((message) => message.requestId).sort()).toEqual([...ids].sort());
		expect(replyBytes).toBeGreaterThan(LINK_WINDOW_BYTES);
	});
});
