/**
 * Every read path of the store, run over a tree nobody may write to: if any of them wrote (a rewrite of an
 * old file, a lock file, a missing newline, a created directory) it would fail here, and the tree is compared
 * byte for byte, mode and time before and after.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import { createSessionStore } from "../../backends/pi/store/session-store";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { imageBlock, SessionBuilder, textBlock, writeSession } from "./store_fixtures";

const NOBODY: LiveOverlay = { row: () => undefined };
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let env: PiTestEnv;
let store: SessionStore;

beforeEach(() => {
	env = createPiTestEnv();
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
	store = createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: () => undefined }),
		now: Date.now,
	});
});

afterEach(() => {
	allow(env.root);
	store.dispose();
	env.dispose();
});

interface Entry {
	readonly path: string;
	readonly kind: "dir" | "file" | "link";
	readonly mode: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly content?: string;
}

function snapshot(root: string): Entry[] {
	const found: Entry[] = [];
	const visit = (path: string): void => {
		const stats = lstatSync(path);
		const kind = stats.isDirectory() ? "dir" : stats.isSymbolicLink() ? "link" : "file";
		found.push({
			path,
			kind,
			mode: stats.mode,
			size: stats.size,
			mtimeMs: stats.mtimeMs,
			...(kind === "file" && { content: readFileSync(path, "latin1") }),
		});
		if (kind === "dir") for (const name of readdirSync(path).sort()) visit(join(path, name));
	};
	visit(root);
	return found;
}

function forbid(path: string): void {
	const stats = lstatSync(path);
	if (stats.isDirectory()) {
		for (const name of readdirSync(path)) forbid(join(path, name));
		chmodSync(path, 0o555);
	} else if (!stats.isSymbolicLink()) {
		chmodSync(path, 0o444);
	}
}

function allow(path: string): void {
	const stats = lstatSync(path);
	if (stats.isSymbolicLink()) return;
	chmodSync(path, stats.isDirectory() ? 0o755 : 0o644);
	if (stats.isDirectory()) for (const name of readdirSync(path)) allow(join(path, name));
}

function tree(): void {
	const globalDir = join(env.agentDir, "sessions", "--project--");
	const current = new SessionBuilder({ id: "current", cwd: env.cwd, version: 3, createdAt: 100 });
	current.custom("broski.origin", undefined, 101);
	current.user([textBlock("with an image"), imageBlock(PIXEL)], 110);
	current.assistant([textBlock("seen")], 120);
	writeSession(globalDir, current);
	const old = new SessionBuilder({ id: "v1", cwd: env.cwd, createdAt: 50 });
	old.user("a version one prompt", 60);
	old.assistant([textBlock("old answer")], 70);
	writeSession(globalDir, old);
	const second = new SessionBuilder({ id: "v2", cwd: env.cwd, version: 2, createdAt: 55 });
	second.user("a version two prompt", 65);
	writeSession(globalDir, second);
	const unterminated = new SessionBuilder({ id: "no-newline", cwd: env.cwd, version: 3, createdAt: 40 });
	unterminated.user("no final newline", 45);
	writeSession(globalDir, unterminated, { terminated: false });
	writeFileSync(join(globalDir, "empty.jsonl"), "");
	writeFileSync(join(globalDir, "notes.jsonl"), "not a session\n");
	mkdirSync(join(env.cwd, ".pi"));
	writeFileSync(join(env.cwd, ".pi", "settings.json"), JSON.stringify({ sessionDir: "own" }));
	const own = new SessionBuilder({ id: "own", cwd: env.cwd, version: 3, createdAt: 200 });
	own.user("in the project's own directory", 210);
	writeSession(join(env.cwd, "own"), own);
	writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
}

describe("with nothing writable", () => {
	test("list, get, transcript, attachment, locate and the watch change nothing and fail on nothing", async () => {
		tree();
		forbid(env.root);
		const before = snapshot(env.root);

		store.watch(NOBODY);
		const listed = await store.list({ cwd: env.cwd }, { limit: 50 }, NOBODY);
		const everything = await store.list({}, { limit: 50 }, NOBODY);
		const ids = (everything.status === "accepted" ? everything.page.items : [])
			.map((row) => row.session.sessionId)
			.sort();
		const results = [];
		for (const id of ids) {
			results.push(await store.get(id, NOBODY));
			let cursor: string | undefined;
			do {
				const page = await store.transcript(id, { limit: 1, ...(cursor !== undefined && { cursor }) }, NOBODY);
				results.push(page);
				cursor = page.status === "accepted" ? page.page.nextCursor : undefined;
			} while (cursor !== undefined);
			results.push({ status: (await store.locate(id)) === undefined ? "rejected" : "accepted" });
		}
		const attachment = await store.attachment("current", "e0000002:1");
		await Bun.sleep(400);
		store.dispose();

		expect(listed.status === "accepted" && listed.page.items.map((row) => row.session.sessionId)).toEqual(["own"]);
		expect(ids).toEqual(["current", "no-newline", "own", "v1", "v2"]);
		expect(results.every((result) => result.status === "accepted")).toBe(true);
		expect(attachment).toEqual({ status: "accepted", image: { kind: "image", mimeType: "image/png", data: PIXEL } });
		expect(snapshot(env.root)).toEqual(before);
	});
});
