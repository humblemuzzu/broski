/**
 * D36: the SDK's session functions read `CLAUDE_CONFIG_DIR` from their thread's environment, so an explicit config
 * dir runs them in a worker that has it, and the bridge's `process.env` is never written.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSdk, NO_WORKER_IN_A_COMPILED_BRIDGE } from "../../../backends/claude-code/sdk/claude-sdk";
import { writeFixtureSession } from "../helpers/fixture-transcripts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-config-dir-")));
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

describe("D36: an explicit config dir", () => {
	test("two concurrent reads against two config dirs each see their own sessions", async () => {
		const a = sessionsIn("a", 3);
		const b = sessionsIn("b", 2);
		const decoy = sessionsIn("decoy", 1);
		const saved = process.env.CLAUDE_CONFIG_DIR;
		process.env.CLAUDE_CONFIG_DIR = decoy.configDir;
		const sdkA = createClaudeSdk({ configDir: a.configDir, env: {} });
		const sdkB = createClaudeSdk({ configDir: b.configDir, env: {} });
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

	test("mutations run there too, and a disposed port refuses", async () => {
		const c = sessionsIn("c", 1);
		const sdk = createClaudeSdk({ configDir: c.configDir, env: {} });
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

	test("in a compiled bridge, which carries no worker, every session read refuses with why; none starts a worker", async () => {
		const d = sessionsIn("d", 1);
		const sdk = createClaudeSdk({ configDir: d.configDir, env: {}, compiled: true });
		const [sessionId = ""] = d.ids;
		const said = await Promise.all(
			[
				sdk.listSessions({ dir: d.cwd }),
				sdk.getSessionInfo(sessionId),
				sdk.getSessionMessages(sessionId),
				sdk.renameSession(sessionId, "x"),
				sdk.resolveSettings({ cwd: d.cwd }),
			].map((call) =>
				Promise.resolve(call).then(
					() => "answered",
					(error: Error) => error.message,
				),
			),
		);
		expect(new Set(said)).toEqual(new Set([NO_WORKER_IN_A_COMPILED_BRIDGE]));
		expect(sdk.configRoot()).toBe(d.configDir);
		await sdk.dispose();
	});
});
