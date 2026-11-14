/**
 * The SDK every real-CLI test builds on reads only its own home: its session functions run in a worker under that
 * home's `CLAUDE_CONFIG_DIR`, and the test process's `process.env` is never written.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureSession } from "../helpers/fixture-transcripts";
import { isolatedClaudeSdk } from "../helpers/isolated-sdk";

const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-isolated-sdk-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function home(name: string): { configDir: string; cwd: string } {
	const configDir = join(root, name, ".claude");
	const cwd = join(root, name, "project");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	return { configDir, cwd };
}

function sessionsIn(name: string, count: number) {
	const place = home(name);
	const ids = Array.from({ length: count }, () => crypto.randomUUID());
	for (const sessionId of ids) writeFixtureSession(place.configDir, { sessionId, cwd: place.cwd, prompts: [name] });
	return { ...place, ids };
}

describe("an SDK bound to one test home", () => {
	test("two concurrent reads against two homes each see their own sessions, never the process's", async () => {
		const a = sessionsIn("a", 3);
		const b = sessionsIn("b", 2);
		const decoy = sessionsIn("decoy", 1);
		const saved = process.env.CLAUDE_CONFIG_DIR;
		process.env.CLAUDE_CONFIG_DIR = decoy.configDir;
		const sdkA = isolatedClaudeSdk({ CLAUDE_CONFIG_DIR: a.configDir });
		const sdkB = isolatedClaudeSdk({ CLAUDE_CONFIG_DIR: b.configDir });
		try {
			const reads = await Promise.all([
				sdkA.listSessions({}),
				sdkB.listSessions({}),
				sdkA.listSessions({ dir: a.cwd }),
				sdkB.getSessionMessages(b.ids[0] ?? "", { dir: b.cwd }),
				sdkA.getSessionInfo(b.ids[0] ?? ""),
			]);
			const [allA, allB, inA, messagesB, crossed] = reads;
			expect(allA.map((row) => row.sessionId).sort()).toEqual([...a.ids].sort());
			expect(allB.map((row) => row.sessionId).sort()).toEqual([...b.ids].sort());
			expect(inA.map((row) => row.sessionId).sort()).toEqual([...a.ids].sort());
			expect(messagesB.map((message) => message.type)).toEqual(["user", "assistant"]);
			expect(crossed).toBeUndefined();
			expect(process.env.CLAUDE_CONFIG_DIR).toBe(decoy.configDir);
			expect(sdkA.configRoot()).toBe(a.configDir);
		} finally {
			if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
			else process.env.CLAUDE_CONFIG_DIR = saved;
			await Promise.all([sdkA.dispose(), sdkB.dispose()]);
		}
	});

	test("mutations that read the config dir after an await land there too, and a disposed SDK refuses", async () => {
		const c = sessionsIn("c", 1);
		const sdk = isolatedClaudeSdk({ CLAUDE_CONFIG_DIR: c.configDir });
		const [sessionId = ""] = c.ids;
		try {
			await sdk.renameSession(sessionId, "Renamed", { dir: c.cwd });
			const fork = await sdk.forkSession(sessionId, { dir: c.cwd });
			const rows = await sdk.listSessions({ dir: c.cwd });
			expect(rows.find((row) => row.sessionId === sessionId)?.customTitle).toBe("Renamed");
			expect(rows.map((row) => row.sessionId)).toContain(fork.sessionId);
			const unknown = await sdk.forkSession(crypto.randomUUID()).then(
				() => "forked",
				(error: Error) => error.message,
			);
			expect(unknown).toContain("not found");
		} finally {
			await sdk.dispose();
		}
		const late = await sdk.listSessions({}).then(
			() => "listed",
			(error: Error) => error.message,
		);
		expect(late).toContain("disposed");
	});
});
