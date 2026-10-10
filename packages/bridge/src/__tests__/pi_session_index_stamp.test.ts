import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIndexedPiSessions } from "../connectors/pi/pi-session-list-indexed";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-paths";
import { clearPiStatsCache } from "../connectors/pi/pi-session-stats";
import { forgetPiSessionIndex } from "../index-cache/pi-session-index";

const CWD = "/tmp/broski-pi-stamp-project";

let tmpDirs: string[] = [];

async function makeDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tmpDirs.push(dir);
	return dir;
}

afterEach(async () => {
	forgetPiSessionIndex();
	clearPiStatsCache();
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

function sessionContent(firstMessage: string): string {
	const header = JSON.stringify({
		type: "session",
		version: 3,
		id: "id-a",
		timestamp: "2026-08-12T10:23:27.438Z",
		cwd: CWD,
	});
	const message = JSON.stringify({
		type: "message",
		id: "m-1",
		parentId: null,
		timestamp: "2026-08-12T10:23:28.671Z",
		message: { role: "user", content: firstMessage, timestamp: 1_700_000_100_000 },
	});
	return `${header}\n${message}\n`;
}

describe("pi session index stamps", () => {
	test("recomputes a file rewritten under the same mtime and size", async () => {
		const root = await makeDir("broski-pi-stamp-root-");
		const cacheRoot = await makeDir("broski-pi-stamp-cache-");
		const dir = defaultSessionDirForCwd(CWD, root);
		await mkdir(dir, { recursive: true });
		const path = join(dir, "a.jsonl");

		// Both writes have the same byte length, so only the inode's ctime can tell them apart.
		const position = 1_700_000_000;
		await writeFile(path, sessionContent("aaaa"));
		await utimes(path, position, position);
		expect((await listIndexedPiSessions({ root, cacheRoot }))[0]?.firstMessage).toBe("aaaa");

		await Bun.sleep(20);
		await writeFile(path, sessionContent("bbbb"));
		await utimes(path, position, position);
		forgetPiSessionIndex();

		expect((await listIndexedPiSessions({ root, cacheRoot }))[0]?.firstMessage).toBe("bbbb");
	});
});
