/**
 * What the store does with files that misbehave: appended to, truncated, replaced, deleted or locked while
 * they are read, links that loop, directories of thousands of sessions, a 200 MB file, and bytes that are
 * not UTF-8.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	appendFileSync,
	chmodSync,
	closeSync,
	openSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import type { ItemsOfEntry } from "../../backends/pi/store/branch-items";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { createSessionStore } from "../../backends/pi/store/session-store";
import { readTranscript } from "../../backends/pi/store/transcript";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { itemsOfEntryStub, SessionBuilder, T0, textBlock, writeSession } from "./store_fixtures";

setDefaultTimeout(120_000);

let env: PiTestEnv;
let store: SessionStore;

const NOBODY: LiveOverlay = { row: () => undefined };

beforeEach(() => {
	env = createPiTestEnv();
	store = createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: () => undefined }),
		now: Date.now,
	});
});

afterEach(() => {
	store.dispose();
	env.dispose();
});

function turns(id: string, count: number, cwd = env.cwd): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3 });
	for (let turn = 0; turn < count; turn += 1) {
		builder.user(`question ${turn}`, turn * 10);
		builder.assistant([textBlock(`answer ${turn}`)], turn * 10 + 5);
	}
	return builder;
}

async function ids(sessionId: string, limit: number, first?: { limit: number }): Promise<string[]> {
	const found: string[] = [];
	let cursor: string | undefined;
	let page = first ?? { limit };
	do {
		const result = await store.transcript(sessionId, { ...page, ...(cursor !== undefined && { cursor }) }, NOBODY);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		found.push(...result.page.items.map((item) => item.id));
		cursor = result.page.nextCursor;
		page = { limit };
	} while (cursor !== undefined);
	return found;
}

describe("a file that changes while it is read", () => {
	test("appended to between every page, it is paged without a repeat or a gap", async () => {
		const builder = turns("growing", 12);
		const path = writeSession(env.sessionDir, builder);
		const snapshot = await ids("growing", 200);

		const paged: string[] = [];
		let cursor: string | undefined;
		for (let round = 0; round < 40; round += 1) {
			const result = await store.transcript("growing", { limit: 3, ...(cursor !== undefined && { cursor }) }, NOBODY);
			if (result.status === "rejected") throw new Error(result.rejection.message);
			paged.push(...result.page.items.map((item) => item.id));
			cursor = result.page.nextCursor;
			builder.user(`late ${round}`, 1_000 + round * 10);
			builder.assistant([textBlock("later")], 1_005 + round * 10);
			appendFileSync(
				path,
				builder.lines
					.slice(-2)
					.map((line) => `${JSON.stringify(line)}\n`)
					.join(""),
			);
			if (cursor === undefined) break;
		}

		expect(paged).toEqual(snapshot);
		expect(new Set(paged).size).toBe(paged.length);
	});

	test("truncated or replaced under a cursor, it refuses the cursor instead of paging something else", async () => {
		const path = writeSession(env.sessionDir, turns("shrinking", 12));
		const first = await store.transcript("shrinking", { limit: 4 }, NOBODY);
		const cursor = first.status === "accepted" ? first.page.nextCursor : undefined;
		truncateSync(path, Math.floor(statSync(path).size / 2));

		const truncated = await store.transcript("shrinking", { limit: 4, cursor }, NOBODY);

		expect(truncated.status).toBe("rejected");
		const replacement = turns("shrinking", 3);
		writeFileSync(`${path}.new`, replacement.text());
		renameSync(`${path}.new`, path);
		const replaced = await store.transcript("shrinking", { limit: 4, cursor }, NOBODY);
		expect(replaced.status).toBe("rejected");
		expect((await store.transcript("shrinking", { limit: 4 }, NOBODY)).status).toBe("accepted");
	});

	test("replaced, truncated or deleted in the middle of a read, the page is refused, never short", async () => {
		const ways: Record<string, (path: string) => void> = {
			truncated: (path) => truncateSync(path, 10),
			replaced: (path) => {
				writeFileSync(`${path}.new`, turns("mid", 30).text());
				renameSync(`${path}.new`, path);
			},
			deleted: (path) => rmSync(path),
		};
		for (const [way, disturb] of Object.entries(ways)) {
			const dirs = piSessionDirs(env.agentDir);
			const index = new SessionIndex(dirs);
			const path = writeSession(env.sessionDir, turns("mid", 20));
			let disturbed = false;
			const itemsOf: ItemsOfEntry = (entry, context) => {
				if (!disturbed) disturb(path);
				disturbed = true;
				return itemsOfEntryStub(entry, context);
			};

			const result = await readTranscript(index, "mid", { limit: 6 }, NOBODY, itemsOf);

			expect({ way, code: result.status === "rejected" && result.rejection.code }).toEqual({
				way,
				code: "backend_error",
			});
			rmSync(path, { force: true });
		}
	});

	test("an old file Pi rewrites in place under a cursor is refused, since its ids and offsets moved", async () => {
		const builder = new SessionBuilder({ id: "ancient", cwd: env.cwd });
		for (let turn = 0; turn < 8; turn += 1) {
			builder.user(`question ${turn}`, turn * 10);
			builder.assistant([textBlock(`answer ${turn}`)], turn * 10 + 5);
		}
		const path = writeSession(env.sessionDir, builder);
		const first = await store.transcript("ancient", { limit: 4 }, NOBODY);
		const cursor = first.status === "accepted" ? first.page.nextCursor : undefined;
		const before = statSync(path);

		SessionManager.open(path, env.sessionDir);

		expect(statSync(path).ino).toBe(before.ino);
		expect(statSync(path).size).toBeGreaterThan(before.size);
		const second = await store.transcript("ancient", { limit: 4, cursor }, NOBODY);
		expect(second.status).toBe("rejected");
		const fresh = await store.transcript("ancient", { limit: 4 }, NOBODY);
		expect(fresh.status === "accepted" && fresh.page.idStability).toBe("stable");
	});

	test("a session deleted since it was listed is not_found everywhere", async () => {
		const path = writeSession(env.sessionDir, turns("vanishing", 3));
		expect((await store.get("vanishing", NOBODY)).status).toBe("accepted");
		rmSync(path);

		for (const result of [
			await store.get("vanishing", NOBODY),
			await store.transcript("vanishing", { limit: 5 }, NOBODY),
			await store.attachment("vanishing", "e0000001:0"),
		]) {
			expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
		}
		expect(await store.locate("vanishing")).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});

	test("a parent cycle in the file ends the branch and the read returns", async () => {
		const builder = new SessionBuilder({ id: "cycle", cwd: env.cwd, version: 3 });
		const entry = (id: string, parentId: string) => ({
			type: "message",
			id,
			parentId,
			timestamp: "2026-03-01T10:00:00.000Z",
			message: { role: "user", content: id, timestamp: T0 },
		});
		builder.raw(entry("c0000001", "c0000002"));
		builder.raw(entry("c0000002", "c0000001"));
		builder.raw(entry("c0000003", "c0000003"));
		writeSession(env.sessionDir, builder);

		expect(await ids("cycle", 10)).toEqual(["c0000003:0"]);
	});
});

describe("files and directories that cannot be read or that loop", () => {
	test("an unreadable file and an unreadable directory are skipped, the rest is listed", async () => {
		if (process.getuid?.() === 0) return;
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		const root = join(env.agentDir, "sessions");
		writeSession(join(root, "--ok--"), turns("fine", 2));
		const locked = writeSession(join(root, "--ok--"), turns("locked", 2));
		writeSession(join(root, "--closed--"), turns("closed", 2));
		chmodSync(locked, 0o000);
		chmodSync(join(root, "--closed--"), 0o000);
		try {
			const listed = await store.list({}, { limit: 50 }, NOBODY);
			const missing = await store.transcript("locked", { limit: 5 }, NOBODY);

			expect(listed.status === "accepted" && listed.page.items.map((row) => row.session.sessionId)).toEqual(["fine"]);
			expect(missing.status === "rejected" && missing.rejection.code).toBe("not_found");
		} finally {
			chmodSync(locked, 0o644);
			chmodSync(join(root, "--closed--"), 0o755);
		}
	});

	test("links that loop, to files and to directories, are skipped", async () => {
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		const root = join(env.agentDir, "sessions");
		writeSession(join(root, "--ok--"), turns("fine", 2));
		symlinkSync("loop-b.jsonl", join(root, "--ok--", "loop-a.jsonl"));
		symlinkSync("loop-a.jsonl", join(root, "--ok--", "loop-b.jsonl"));
		symlinkSync("--self--", join(root, "--self--"));
		symlinkSync("--two--", join(root, "--one--"));
		symlinkSync("--one--", join(root, "--two--"));
		symlinkSync(root, join(root, "--ok--", "back-to-root"));
		store.watch(NOBODY);

		const listed = await store.list({}, { limit: 50 }, NOBODY);

		expect(listed.status === "accepted" && listed.page.items.map((row) => row.session.sessionId)).toEqual(["fine"]);
		expect((await store.get("nobody", NOBODY)).status).toBe("rejected");
	});
});

describe("writes that cannot happen", () => {
	test("rename, delete and fork in a directory nobody may write are refused as values, and change nothing", async () => {
		if (process.getuid?.() === 0) return;
		const path = writeSession(env.sessionDir, turns("sealed", 3));
		process.env.PATH = join(env.root, "no-trash-here");
		chmodSync(path, 0o444);
		chmodSync(env.sessionDir, 0o555);
		try {
			const results = [
				await store.rename("sealed", "x"),
				await store.remove("sealed", async () => {}),
				await store.fork("sealed", undefined, NOBODY),
			];

			expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
			expect(results.map((result) => result.status === "rejected" && result.rejection.code)).toEqual([
				"backend_error",
				"backend_error",
				"backend_error",
			]);
			expect(readdirSync(env.sessionDir)).toHaveLength(1);
		} finally {
			chmodSync(env.sessionDir, 0o755);
			chmodSync(path, 0o644);
		}
	});

	test("a parent path that is a named pipe is not opened, so a listing does not hang on it", async () => {
		const pipe = join(env.root, "pipe");
		expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
		const fork = new SessionBuilder({ id: "pipe-child", cwd: env.cwd, version: 3, parentSession: pipe });
		fork.user("child", 10);
		writeSession(env.sessionDir, fork);

		const listed = await store.list({}, { limit: 5 }, NOBODY);

		expect(listed.status === "accepted" && listed.page.items[0]?.parent).toBeUndefined();
	});
});

describe("sizes", () => {
	test("10,000 tiny sessions list, page and are found by id in bounded time", async () => {
		for (let n = 0; n < 10_000; n += 1) {
			const builder = new SessionBuilder({ id: `tiny-${String(n).padStart(5, "0")}`, cwd: env.cwd, version: 3 });
			builder.user("hi", 10 + (n % 997));
			writeSession(env.sessionDir, builder);
		}
		const started = performance.now();
		const first = await store.list({ cwd: env.cwd }, { limit: 50 }, NOBODY);
		const coldMs = performance.now() - started;
		const warmStarted = performance.now();
		await store.list({ cwd: env.cwd }, { limit: 50 }, NOBODY);
		const warmMs = performance.now() - warmStarted;
		const seen = new Set<string>();
		let cursor: string | undefined;
		do {
			const page = await store.list({ cwd: env.cwd }, { limit: 200, ...(cursor !== undefined && { cursor }) }, NOBODY);
			if (page.status === "rejected") throw new Error(page.rejection.message);
			for (const row of page.page.items) seen.add(row.session.sessionId);
			cursor = page.page.nextCursor;
		} while (cursor !== undefined);
		const found = performance.now();
		const one = await store.get("tiny-09999", NOBODY);
		const getMs = performance.now() - found;

		expect(first.status).toBe("accepted");
		expect(seen.size).toBe(10_000);
		expect(one.status).toBe("accepted");
		expect(coldMs).toBeLessThan(10_000);
		expect(warmMs).toBeLessThan(1_500);
		expect(getMs).toBeLessThan(500);
	});

	test("a 200 MB session indexes and pages in bounded time and memory", async () => {
		const path = join(env.sessionDir, "2026-03-01T10-00-00-000Z_huge.jsonl");
		const fd = openSync(path, "w");
		const builder = new SessionBuilder({ id: "huge", cwd: env.cwd, version: 3 });
		writeSync(fd, `${JSON.stringify(builder.lines[0])}\n`);
		const pad = "x".repeat(100_000);
		for (let turn = 0; turn < 2_000; turn += 1) {
			builder.user(`q${turn}`, turn * 10);
			builder.assistant([textBlock(pad)], turn * 10 + 5);
			writeSync(
				fd,
				builder.lines
					.slice(-2)
					.map((line) => `${JSON.stringify(line)}\n`)
					.join(""),
			);
		}
		closeSync(fd);
		expect(statSync(path).size).toBeGreaterThan(200_000_000);
		Bun.gc(true);
		const heapBefore = process.memoryUsage().heapUsed;

		const started = performance.now();
		const first = await store.transcript("huge", { limit: 20 }, NOBODY);
		const firstMs = performance.now() - started;
		const listed = await store.list({}, { limit: 5 }, NOBODY);
		Bun.gc(true);
		const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

		expect(first.status).toBe("accepted");
		expect(listed.status === "accepted" && listed.page.items[0]?.title?.text).toBe("q0");
		expect(firstMs).toBeLessThan(10_000);
		expect(heapGrowth).toBeLessThan(80_000_000);
	});
});

describe("bytes that are not text", () => {
	test("invalid UTF-8 in the header and in messages reads as replacement characters, without an error", async () => {
		const bad = Buffer.from([0x62, 0xff, 0xfe, 0x61]);
		const line = (object: object, patch: [string, Buffer][] = []) => {
			let text = Buffer.from(`${JSON.stringify(object)}\n`);
			for (const [marker, bytes] of patch)
				text = Buffer.from(text.toString("latin1").replace(marker, bytes.toString("latin1")), "latin1");
			return text;
		};
		const header = line(
			{ type: "session", version: 3, id: "binary", timestamp: "2026-03-01T10:00:00.000Z", cwd: "/MARK" },
			[["MARK", bad]],
		);
		const user = line(
			{
				type: "message",
				id: "b0000001",
				parentId: null,
				timestamp: "2026-03-01T10:00:01.000Z",
				message: { role: "user", content: "MARK", timestamp: T0 + 1000 },
			},
			[["MARK", bad]],
		);
		writeFileSync(join(env.sessionDir, "binary.jsonl"), Buffer.concat([header, user]));

		const listed = await store.list({}, { limit: 5 }, NOBODY);
		const items = await ids("binary", 10);

		expect(listed.status === "accepted" && listed.page.items[0]?.title?.text).toBe("b\ufffd\ufffda");
		expect(listed.status === "accepted" && listed.page.items[0]?.cwd).toBe("/b\ufffd\ufffda");
		expect(items).toEqual(["b0000001:0"]);
	});
});
