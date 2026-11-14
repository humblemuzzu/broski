/**
 * The store as one system (the real mapping, the real watch): news a listing finds first, forks laid out as Pi's
 * own `createBranchedSession` lays them out, header versions read as Pi reads them, and items of an assistant
 * message whose blocks Pi stores empty.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import { indexSessionFile } from "../../backends/pi/store/jsonl-reader";
import { openRegularFile } from "../../backends/pi/store/open-file";
import { readSessionDetails } from "../../backends/pi/store/session-details";
import { readSessionHead } from "../../backends/pi/store/session-head";
import { createSessionStore } from "../../backends/pi/store/session-store";
import type { CatalogEvent, SessionId } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { fileNameOf, iso, SessionBuilder, textBlock, thinkingBlock, writeSession } from "./store_fixtures";

setDefaultTimeout(15_000);

const NOBODY: LiveOverlay = { row: () => undefined };

let env: PiTestEnv;
let events: CatalogEvent[];
let store: SessionStore;

beforeEach(() => {
	env = createPiTestEnv();
	events = [];
});

afterEach(() => {
	store?.dispose();
	env.dispose();
});

function newStore(): SessionStore {
	store = createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		now: () => Date.parse("2026-03-02T00:00:00.000Z"),
	});
	return store;
}

function chat(id: string, cwd = env.cwd): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3 });
	builder.user(`prompt of ${id}`, 10);
	builder.assistant([textBlock("answer")], 20);
	return builder;
}

const announced = (id: SessionId) =>
	events.some((event) => event.type === "session_updated" && event.summary.session.sessionId === id);

async function until(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await Bun.sleep(20);
	}
}

const listedIds = async (cwd?: string) => {
	const listed = await store.list({ ...(cwd !== undefined && { cwd }) }, { limit: 50 }, NOBODY);
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	return listed.page.items.map((row) => row.session.sessionId);
};

describe("a session another process writes is news for every client", () => {
	test("in a sessions directory that did not exist when the bridge started, found first by a listing", async () => {
		const later = join(env.root, "made-later");
		process.env.PI_CODING_AGENT_SESSION_DIR = later;
		newStore().watch(NOBODY);
		expect(await listedIds()).toEqual([]);

		writeSession(later, chat("first-terminal-session"));
		expect(await listedIds()).toEqual(["first-terminal-session"]);

		await until(() => announced("first-terminal-session"), "the session announced to the other clients");
	});

	test("written just before another sessions directory starts being watched", async () => {
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		const project = env.otherCwd;
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ sessionDir: join(project, "own") }));
		mkdirSync(join(project, "own"));
		const globalDir = join(env.agentDir, "sessions", "--somewhere--");
		mkdirSync(globalDir, { recursive: true });
		newStore().watch(NOBODY);

		writeSession(globalDir, chat("in-the-global-tree"));
		expect(await listedIds(project)).toEqual([]);
		expect(await listedIds()).toContain("in-the-global-tree");

		await until(() => announced("in-the-global-tree"), "the session in the already watched tree");
	});
});

describe("a fork, as Pi's createBranchedSession makes it", () => {
	/** u1, a1, a label on u1, u2 under the label, a2, a compaction keeping from the label, a label on a2. */
	function labelled(id: string): SessionBuilder {
		const builder = new SessionBuilder({ id, cwd: env.cwd, version: 3 });
		const u1 = builder.user("first", 10);
		builder.assistant([textBlock("one")], 20);
		builder.raw({
			type: "label",
			id: "l0000001",
			parentId: "e0000002",
			timestamp: iso(30),
			targetId: u1,
			label: "start",
		});
		builder.branchFrom("l0000001");
		builder.user("second", 40);
		const a2 = builder.assistant([textBlock("two")], 50);
		builder.compaction("summary", "l0000001", 60);
		builder.raw({
			type: "label",
			id: "l0000002",
			parentId: "e0000005",
			timestamp: iso(70),
			targetId: a2,
			label: "answer",
		});
		builder.raw({
			type: "label",
			id: "l0000003",
			parentId: "l0000002",
			timestamp: iso(80),
			targetId: u1,
			label: "first",
		});
		return builder;
	}

	type Entry = {
		type: string;
		id: string;
		parentId: string | null;
		targetId?: string;
		label?: string;
		firstKeptEntryId?: string;
	};

	const entriesOf = (path: string): Entry[] =>
		readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line !== "")
			.slice(1)
			.map((line) => JSON.parse(line));

	/** What Pi writes for the same branch, from a copy of the file: the source itself is never opened with Pi's manager. */
	function forkedByPi(source: string, leafId: string): Entry[] {
		const dir = join(env.root, "pi-fork");
		mkdirSync(dir, { recursive: true });
		const copy = join(dir, "copy.jsonl");
		copyFileSync(source, copy);
		const forked = SessionManager.open(copy, dir).createBranchedSession(leafId);
		if (forked === undefined) throw new Error("Pi wrote no fork");
		return entriesOf(forked);
	}

	test("drops the branch's labels, chains each kept entry under the one before, and adds the file's labels again", async () => {
		const builder = labelled("labelled");
		const source = writeSession(env.sessionDir, builder);
		newStore();
		const result = await store.fork("labelled", undefined, NOBODY);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		const fork = forkFile(result.session.sessionId);

		const ours = entriesOf(fork);
		const [origin, ...kept] = ours;
		expect(origin).toMatchObject({ type: "custom", customType: "broski.origin", parentId: null });
		const pi = forkedByPi(source, "l0000003");
		const shape = (entries: Entry[], root: string | null) =>
			entries.map((entry, position) => ({
				type: entry.type,
				id: entry.type === "label" ? "label" : entry.id,
				parent:
					position === 0
						? entry.parentId === root
							? "root"
							: entry.parentId
						: entry.parentId === entries[position - 1]?.id
							? "previous"
							: entry.parentId,
				...(entry.type === "label" && { targetId: entry.targetId, label: entry.label }),
				...(entry.type === "compaction" && { firstKeptEntryId: entry.firstKeptEntryId }),
			}));
		expect(shape(kept, origin?.id ?? null)).toEqual(shape(pi, null));
		expect(kept.filter((entry) => entry.type === "label").map((entry) => [entry.targetId, entry.label])).toEqual([
			["e0000001", "first"],
			["e0000004", "answer"],
		]);
		expect(kept.find((entry) => entry.type === "compaction")?.firstKeptEntryId).toBe("e0000003");
	});

	function forkFile(sessionId: SessionId): string {
		const name = readdirSync(env.sessionDir).find((file) => file.endsWith(`_${sessionId}.jsonl`));
		if (name === undefined) throw new Error(`no file for the fork ${sessionId}`);
		return join(env.sessionDir, name);
	}
});

describe("a header's version, as Pi's migration reads it", () => {
	test.each([
		['"3"', "stable"],
		['"abc"', "stable"],
	] as const)("version %s: entries are read with the ids the file gives them", async (version, stability) => {
		const builder = chat("versioned");
		const lines = builder.text().split("\n");
		lines[0] = (lines[0] ?? "").replace('"version":3', `"version":${version}`);
		const path = join(env.sessionDir, fileNameOf(builder));
		writeFileSync(path, lines.join("\n"));
		newStore();

		const read = await store.transcript("versioned", { limit: 50 }, NOBODY);
		if (read.status === "rejected") throw new Error(read.rejection.message);
		expect(read.page.idStability).toBe(stability);
		expect(read.page.items.map((item) => item.id)).toEqual(["e0000002:0", "e0000001:0"]);

		const copyDir = join(env.root, "copy");
		mkdirSync(copyDir, { recursive: true });
		copyFileSync(path, join(copyDir, "copy.jsonl"));
		const pi = SessionManager.open(join(copyDir, "copy.jsonl"), copyDir);
		expect(pi.getEntries().map((entry) => entry.id)).toEqual(["e0000001", "e0000002"]);
	});
});

describe("an assistant message that begins with an empty thinking block", () => {
	test("its text item is found where its id says, for a fork through it and before it", async () => {
		const builder = new SessionBuilder({ id: "signed", cwd: env.cwd, version: 3 });
		builder.user("question", 10);
		builder.assistant([thinkingBlock(""), textBlock("the answer")], 20);
		builder.user("next", 30);
		builder.assistant([textBlock("more")], 40);
		writeSession(env.sessionDir, builder);
		newStore();

		const read = await store.transcript("signed", { limit: 50 }, NOBODY);
		if (read.status === "rejected") throw new Error(read.rejection.message);
		expect(read.page.items.map((item) => item.id)).toContain("e0000002:1");
		const forked = await store.fork("signed", { itemId: "e0000002:1", position: "through" }, NOBODY);
		expect(forked.status).toBe("accepted");
		const before = await store.fork("signed", { itemId: "e0000002:1", position: "before" }, NOBODY);
		expect(before.status).toBe("accepted");
	});
});

describe("a path that is a named pipe", () => {
	test("is never read, and no reader blocks on it: each answers that it holds no session", async () => {
		const pipe = join(env.sessionDir, "pipe.jsonl");
		expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0);
		expect(await openRegularFile(pipe)).toBeUndefined();
		expect(await readSessionHead(pipe)).toBeUndefined();
		expect(await readSessionDetails(pipe)).toBeUndefined();
		expect(await indexSessionFile(pipe)).toBeUndefined();
		newStore();
		expect(await listedIds()).toEqual([]);
	});
});
