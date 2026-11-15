import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeConnectPty, nativeCreatePty, nativeDeletePty, nativeResizePty } from "../workspace/pty/native-pty";
import { ensureNativePtyLibrary } from "./helpers/native-pty-library";

const CHILD_OUTPUT_DEADLINE_MS = 10_000;
const PTY_TEST_TIMEOUT_MS = 25_000;

let tmpDirs: string[] = [];

async function makeChildScript(body: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-pty-child-"));
	tmpDirs.push(dir);
	const path = join(dir, "child.sh");
	await writeFile(path, body, { mode: 0o755 });
	return path;
}

async function waitForOutput(read: () => string, expected: string): Promise<string> {
	const deadline = Date.now() + CHILD_OUTPUT_DEADLINE_MS;
	while (!read().includes(expected) && Date.now() < deadline) await Bun.sleep(10);
	return read();
}

const encoder = new TextEncoder();

beforeAll(() => {
	ensureNativePtyLibrary();
});

afterEach(async () => {
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

describe("Native PTY integration", () => {
	test(
		"supports shell I/O with a real TTY",
		async () => {
			const script = await makeChildScript('while read -r line; do printf "got:%s\\n" "$line"; done\n');
			const session = await nativeCreatePty({ command: script });
			expect(session).toBeTruthy();
			if (!session) return;

			const conn = nativeConnectPty(session.id);
			try {
				expect(conn).toBeTruthy();
				if (!conn) return;

				let output = "";
				const decoder = new TextDecoder();
				conn.onData((data) => {
					output += decoder.decode(data, { stream: true });
				});

				conn.write(encoder.encode("native-pty-ok\n"));
				expect(await waitForOutput(() => output, "got:native-pty-ok")).toContain("got:native-pty-ok");
			} finally {
				conn?.disconnect();
				await nativeDeletePty(session.id);
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);

	test(
		"supports resize updates (smooth terminal geometry behavior)",
		async () => {
			const script = await makeChildScript("while read -r line; do stty size; done\n");
			const session = await nativeCreatePty({ rows: 24, cols: 80, command: script });
			expect(session).toBeTruthy();
			if (!session) return;

			const conn = nativeConnectPty(session.id);
			try {
				expect(conn).toBeTruthy();
				if (!conn) return;

				let output = "";
				const decoder = new TextDecoder();
				conn.onData((data) => {
					output += decoder.decode(data, { stream: true });
				});

				conn.write(encoder.encode("initial\n"));
				const initial = await waitForOutput(() => output, "24 80");
				expect(initial).toContain("24 80");
				expect(initial).not.toContain("42 130");

				expect(nativeResizePty(session.id, { rows: 42, cols: 130 })).toBe(true);
				conn.write(encoder.encode("resized\n"));
				expect(await waitForOutput(() => output, "42 130")).toContain("42 130");
			} finally {
				conn?.disconnect();
				await nativeDeletePty(session.id);
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);
});
