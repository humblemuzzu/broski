/**
 * The order `listSessions` returns, which the store's keyset cursor must reproduce: newest `lastModified` first, and on
 * a tie the greater `sessionId` first.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureSession } from "../helpers/fixture-transcripts";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";

const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-order-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("listSessions: newest first, ties by sessionId descending, paged or not", async () => {
	const configDir = join(root, ".claude");
	const cwd = join(root, "project");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const tied = new Date("2026-01-01T00:00:00Z");
	const newer = new Date("2026-01-02T00:00:00Z");
	const ids = ["1", "3", "2", "0"].map(
		(digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
	);
	ids.forEach((sessionId, index) => {
		const path = writeFixtureSession(configDir, { sessionId, cwd, prompts: ["x"] });
		const at = index === 3 ? newer : tied;
		utimesSync(path, at, at);
	});
	const sdk = isolatedClaudeSdk({ CLAUDE_CONFIG_DIR: configDir });
	try {
		const expected = [3, 1, 2, 0].map((index) => ids[index] ?? "");
		expect((await sdk.listSessions({ dir: cwd })).map((row) => row.sessionId)).toEqual(expected);
		expect((await sdk.listSessions({ dir: cwd, limit: 10 })).map((row) => row.sessionId)).toEqual(expected);
		expect((await sdk.listSessions({ dir: cwd, limit: 2, offset: 1 })).map((row) => row.sessionId)).toEqual(
			expected.slice(1, 3),
		);
	} finally {
		await sdk.dispose();
	}
});
