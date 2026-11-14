/**
 * The reader a session installs has to be gone once the session is: no callback after a delete, no
 * descriptor left behind. The old reader leaked a timer per wake-up instead, so these also pin the
 * shape of the shutdown rather than only its effect.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isNativePtyAvailable,
	nativeConnectPty,
	nativeCreatePty,
	nativeDeletePty,
	nativeGetPty,
	nativeListPty,
} from "../workspace/pty/native-pty";

const PTY_TEST_TIMEOUT_MS = 25_000;
const EXIT_DEADLINE_MS = 10_000;
const IDLE_COMMAND = { command: "sleep", args: ["30"] };

const createdIds: string[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
	for (const id of createdIds) await nativeDeletePty(id).catch(() => {});
	for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function makeChildScript(body: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-pty-lifecycle-"));
	tempDirs.push(dir);
	const path = join(dir, "child.sh");
	await writeFile(path, body, { mode: 0o755 });
	return path;
}

function openFdCount(): number {
	return readdirSync("/dev/fd").length;
}

const sleep = (ms: number) => Bun.sleep(ms);

describe("native PTY session lifecycle", () => {
	test(
		"a child exit is reported once with its exit code, then reading stays quiet",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const script = await makeChildScript('printf "bye-exit\\n"; exit 7\n');
			const session = await nativeCreatePty({ command: script });
			expect(session).toBeTruthy();
			if (!session) return;
			createdIds.push(session.id);

			const connection = nativeConnectPty(session.id);
			expect(connection).toBeTruthy();
			if (!connection) return;

			let output = "";
			let exitCode: number | undefined;
			let exits = 0;
			connection.onData((data) => {
				output += data;
			});
			connection.onExit((code) => {
				exits += 1;
				exitCode = code;
			});

			const deadline = Date.now() + EXIT_DEADLINE_MS;
			while (exits === 0 && Date.now() < deadline) await Bun.sleep(5);

			expect(output).toContain("bye-exit");
			expect(exits).toBe(1);
			expect(exitCode).toBe(7);

			const lengthAtExit = output.length;
			await sleep(250);
			expect(output.length).toBe(lengthAtExit);
			expect(exits).toBe(1);

			const session_ = await nativeGetPty(session.id);
			expect(session_?.status).toBe("exited");
			expect(await nativeDeletePty(session.id)).toBe(true);
			expect(await nativeGetPty(session.id)).toBeNull();
		},
		PTY_TEST_TIMEOUT_MS,
	);

	test(
		"deleting a session stops its reader and closes its descriptor",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const fdsBefore = openFdCount();
			const session = await nativeCreatePty(IDLE_COMMAND);
			expect(session).toBeTruthy();
			if (!session) return;
			createdIds.push(session.id);

			const connection = nativeConnectPty(session.id);
			expect(connection).toBeTruthy();
			if (!connection) return;

			let chunks = 0;
			connection.onData(() => {
				chunks += 1;
			});
			await sleep(200);
			expect(openFdCount()).toBeGreaterThan(fdsBefore);

			expect(await nativeDeletePty(session.id)).toBe(true);
			const chunksAtDelete = chunks;
			await sleep(300);

			expect(openFdCount()).toBeLessThanOrEqual(fdsBefore);
			expect(chunks).toBe(chunksAtDelete);
			expect(await nativeListPty()).toEqual([]);
		},
		PTY_TEST_TIMEOUT_MS,
	);
});
