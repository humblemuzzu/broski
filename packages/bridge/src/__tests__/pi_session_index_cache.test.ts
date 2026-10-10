import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { mapSessionInfo } from "../connectors/pi/pi-session-info";
import { buildPiSessionInfoFast } from "../connectors/pi/pi-session-info-fast";
import { buildPiSessionInfoReadline } from "../connectors/pi/pi-session-info-readline";
import { buildPiSessionInfoReference } from "../connectors/pi/pi-session-info-reference";
import {
	computePiSessionInfo,
	listIndexedPiSessions,
	refreshSessionIndex,
} from "../connectors/pi/pi-session-list-indexed";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-paths";
import { clearPiStatsCache } from "../connectors/pi/pi-session-stats";
import { forgetPiSessionIndex, openPiSessionIndex } from "../index-cache/pi-session-index";
import { PI_SESSION_INDEX_FILE } from "../index-cache/pi-session-index-record";
import type { PiSessionInfo } from "../types/pi";

const CWD = "/tmp/broski-pi-index-project";

let tmpDirs: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "broski-pi-index-"));
	tmpDirs.push(root);
	return root;
}

async function makeCacheRoot(): Promise<string> {
	const cacheRoot = await mkdtemp(join(tmpdir(), "broski-pi-index-cache-"));
	tmpDirs.push(cacheRoot);
	return cacheRoot;
}

function sessionLine(cwd: string, id: string, timestamp: string): string {
	return `${JSON.stringify({ type: "session", version: 3, id, timestamp, cwd })}\n`;
}

function messageLine(role: string, text: string, timestamp: number, timestampIso: string): string {
	return `${JSON.stringify({
		type: "message",
		id: `m-${timestamp}`,
		parentId: null,
		timestamp: timestampIso,
		message: { role, content: text, timestamp },
	})}\n`;
}

async function writeSession(root: string, name: string, lines: string): Promise<string> {
	const dir = defaultSessionDirForCwd(CWD, root);
	await mkdir(dir, { recursive: true });
	const path = join(dir, name);
	await writeFile(path, lines);
	return path;
}

function plain(info: SessionInfo): Record<string, unknown> {
	return {
		path: info.path,
		id: info.id,
		cwd: info.cwd,
		name: info.name ?? null,
		parentSessionPath: info.parentSessionPath ?? null,
		created: info.created.getTime(),
		modified: info.modified.getTime(),
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
	};
}

function normalize(session: PiSessionInfo): Record<string, unknown> {
	return {
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name ?? null,
		parentSessionPath: session.parentSessionPath ?? null,
		created: session.created,
		modified: session.modified,
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
		summary: session.summary ?? null,
		subagentToolCount: session.subagentToolCount ?? null,
	};
}

async function fileStamp(path: string) {
	const info = await stat(path);
	return { path, size: info.size, mtime: info.mtime, mtimeMs: info.mtimeMs, ino: info.ino };
}

/** Node's readline, and so the SDK, breaks lines on these as well as on `\n`. */
function hasLineSeparator(text: string): boolean {
	return text.includes("\u2028") || text.includes("\u2029");
}

function reset(): void {
	forgetPiSessionIndex();
	clearPiStatsCache();
}

afterEach(async () => {
	reset();
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

describe("pi session index", () => {
	test("matches the SDK for every session in the directory", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		await writeSession(
			root,
			"a.jsonl",
			sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "hello there", 1_700_000_100_000, "2026-08-12T10:23:28.671Z") +
				messageLine("assistant", "hi", 1_700_000_200_000, "2026-08-12T10:23:29.671Z"),
		);
		await writeSession(
			root,
			"b.jsonl",
			sessionLine(CWD, "id-b", "2026-08-12T10:23:27.438Z") +
				`${JSON.stringify({ type: "session_info", id: "s1", parentId: null, timestamp: "2026-08-12T10:23:30.000Z", name: "  named session  " })}\n`,
		);

		const sdk = (await SessionManager.listAll(defaultSessionDirForCwd(CWD, root))).map((info) =>
			normalize({ ...mapSessionInfo(info), summary: undefined, subagentToolCount: undefined }),
		);
		const indexed = (await listIndexedPiSessions({ root, cacheRoot })).map(normalize);

		expect(indexed).toEqual(sdk);
		expect(indexed).toHaveLength(2);
	});

	test("writes one record per session and reuses them on the next call", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));

		const first = await listIndexedPiSessions({ root, cacheRoot });
		expect(first).toHaveLength(1);

		const indexPath = join(cacheRoot, PI_SESSION_INDEX_FILE);
		expect((await stat(indexPath)).mode & 0o777).toBe(0o600);
		const written = await readFile(indexPath, "utf-8");
		expect(written.split("\n").filter(Boolean).length).toBe(2);

		const stamp = await stat(join(defaultSessionDirForCwd(CWD, root), "a.jsonl"));
		const index = await openPiSessionIndex({ cacheRoot });
		expect(index.lookup(join(defaultSessionDirForCwd(CWD, root), "a.jsonl"), stamp)?.id).toBe("id-a");

		expect(await listIndexedPiSessions({ root, cacheRoot })).toEqual(first);
	});

	test("recomputes only the file that changed", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		const path = await writeSession(
			root,
			"a.jsonl",
			sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "first", 1_700_000_100_000, "2026-08-12T10:23:28.671Z"),
		);
		await listIndexedPiSessions({ root, cacheRoot });

		const before = await openPiSessionIndex({ cacheRoot });
		expect(before.stats().writes).toBeGreaterThan(0);

		await appendFile(path, messageLine("user", "second", 1_700_000_300_000, "2026-08-12T10:23:31.671Z"));
		const afterAppend = await listIndexedPiSessions({ root, cacheRoot });
		expect(afterAppend[0]?.messageCount).toBe(2);
		expect(afterAppend[0]?.firstMessage).toBe("first");
	});

	test("drops a record whose file disappeared", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		const path = await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		await writeSession(root, "b.jsonl", sessionLine(CWD, "id-b", "2026-08-12T10:23:27.438Z"));
		expect(await listIndexedPiSessions({ root, cacheRoot })).toHaveLength(2);

		await rm(path);
		expect((await listIndexedPiSessions({ root, cacheRoot })).map((session) => session.id)).toEqual(["id-b"]);

		expect((await refreshSessionIndex({ root, cacheRoot })).size).toBe(1);
	});

	test("rebuilds the index after the file is corrupted", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		const first = await listIndexedPiSessions({ root, cacheRoot });

		await writeFile(join(cacheRoot, PI_SESSION_INDEX_FILE), "not a json line\n");
		reset();

		expect(await listIndexedPiSessions({ root, cacheRoot })).toEqual(first);
	});

	test("rebuilds the index after a schema bump", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		await listIndexedPiSessions({ root, cacheRoot });

		await writeFile(
			join(cacheRoot, PI_SESSION_INDEX_FILE),
			`${JSON.stringify({ schema: 0 })}\n${JSON.stringify({ path: "x" })}\n`,
		);
		reset();

		expect(await listIndexedPiSessions({ root, cacheRoot })).toHaveLength(1);
	});

	test("serves a changed file from disk when the process restarts", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		const path = await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		await listIndexedPiSessions({ root, cacheRoot });

		reset();
		const restarted = await listIndexedPiSessions({ root, cacheRoot });
		expect(restarted).toHaveLength(1);
		expect(restarted[0]?.id).toBe("id-a");

		await appendFile(path, messageLine("assistant", "late", 1_700_000_400_000, "2026-08-12T10:23:35.671Z"));
		reset();
		expect((await listIndexedPiSessions({ root, cacheRoot }))[0]?.messageCount).toBe(1);
	});

	test("treats a file replaced under the same mtime and size as changed", async () => {
		const root = await makeRoot();
		const cacheRoot = await makeCacheRoot();
		const path = await writeSession(root, "a.jsonl", sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		const stamp = 1_700_000_000;
		await utimes(path, stamp, stamp);
		await listIndexedPiSessions({ root, cacheRoot });

		await writeFile(path, sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"));
		await utimes(path, stamp, stamp);
		reset();

		expect((await listIndexedPiSessions({ root, cacheRoot }))[0]?.id).toBe("id-a");
	});
});

describe("pi session info builders", () => {
	const cases: Array<{ name: string; lines: string }> = [
		{
			name: "plain messages",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "first prompt", 1_700_000_100_000, "2026-08-12T10:23:28.671Z") +
				messageLine("assistant", "answer", 1_700_000_200_000, "2026-08-12T10:23:29.671Z"),
		},
		{
			name: "no messages",
			lines: sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z"),
		},
		{
			name: "a blank and a malformed line",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z")}\n\n{"type":"message",\n`,
		},
		{
			name: "a message with no message object",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z")}${JSON.stringify({ type: "message", id: "m1", parentId: null })}\n`,
		},
		{
			name: "a message whose content is not a string or array",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				`${JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-08-12T10:23:28.671Z", message: { role: "user", content: 5, timestamp: 1_700_000_100_000 } })}\n`,
		},
		{
			name: "a session name that is cleared",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				`${JSON.stringify({ type: "session_info", id: "s1", parentId: null, timestamp: "2026-08-12T10:23:28.671Z", name: "kept" })}\n` +
				`${JSON.stringify({ type: "session_info", id: "s2", parentId: "s1", timestamp: "2026-08-12T10:23:29.671Z" })}\n`,
		},
		{
			name: "a first user message longer than the head",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "u".repeat(9000), 1_700_000_100_000, "2026-08-12T10:23:28.671Z"),
		},
		{
			name: "a user message whose text and timestamp are past the head",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("assistant", "a".repeat(6000), 1_700_000_150_000, "2026-08-12T10:23:28.671Z") +
				messageLine("user", "u".repeat(6000), 1_700_000_100_000, "2026-08-12T10:23:29.671Z"),
		},
		{
			name: "multi-byte characters",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "héllo — 世界 🚀", 1_700_000_100_000, "2026-08-12T10:23:28.671Z"),
		},
		{
			name: "carriage returns",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z").replace("\n", "\r\n")}${messageLine("user", "crlf body", 1_700_000_100_000, "2026-08-12T10:23:28.671Z").replace("\n", "\r\n")}`,
		},
		{
			name: "a last line with no newline",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z")}${messageLine("user", "unterminated", 1_700_000_100_000, "2026-08-12T10:23:28.671Z").trimEnd()}`,
		},
		{
			name: "a truncated last line",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z")}{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":"partial`,
		},
		{
			name: "a line separator inside a message",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				messageLine("user", "before\u2028after", 1_700_000_100_000, "2026-08-12T10:23:28.671Z") +
				messageLine("assistant", "reply", 1_700_000_200_000, "2026-08-12T10:23:29.671Z"),
		},
		{
			name: "trailing garbage after an entry",
			lines: `${sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z")}${JSON.stringify({ type: "label", id: "l1", parentId: null, timestamp: "2026-08-12T10:23:28.671Z" })}garbage\n`,
		},
		{
			name: "content blocks with a non-text block",
			lines:
				sessionLine(CWD, "id-a", "2026-08-12T10:23:27.438Z") +
				`${JSON.stringify({
					type: "message",
					id: "m1",
					parentId: null,
					timestamp: "2026-08-12T10:23:28.671Z",
					message: {
						role: "user",
						content: [
							{ type: "image", data: "x" },
							{ type: "text", text: "caption" },
						],
						timestamp: 1_700_000_100_000,
					},
				})}\n`,
		},
	];

	for (const testCase of cases) {
		test(`reads ${testCase.name} exactly as the SDK does`, async () => {
			const root = await makeRoot();
			const path = await writeSession(root, "a.jsonl", testCase.lines);

			const sdk = (await SessionManager.listAll(defaultSessionDirForCwd(CWD, root))).find((info) => info.path === path);
			const fast = await buildPiSessionInfoFast(path);
			const reference = await buildPiSessionInfoReference(path);
			const pipeline = await computePiSessionInfo(await fileStamp(path));
			const expected = sdk ? plain(sdk) : null;

			expect(pipeline ? plain(pipeline) : null).toEqual(expected);
			expect(await buildPiSessionInfoReadline(path).then((info) => (info ? plain(info) : null))).toEqual(expected);
			if (!hasLineSeparator(testCase.lines)) {
				expect(fast.info ? plain(fast.info) : null).toEqual(expected);
				expect(reference ? plain(reference) : null).toEqual(expected);
			}
		});
	}
});
