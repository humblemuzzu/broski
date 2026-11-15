/**
 * The session file reader (store/jsonl-reader.ts): what it reads from files Pi wrote in each version, and that
 * it never writes one.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	branchTo,
	indexSessionFile,
	lastEntryId,
	readEntries,
	type SessionFileIndex,
} from "../../backends/pi/store/jsonl-reader";
import { runPi } from "./helpers/pi-run";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, toolCall, userEntryText, writeSession } from "./store_fixtures";

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	env.dispose();
});

function chat(options: ConstructorParameters<typeof SessionBuilder>[0]): SessionBuilder {
	const builder = new SessionBuilder(options);
	builder.user("hello", 1_000);
	builder.assistant([textBlock("hi there")], 2_000);
	return builder;
}

function snapshotOf(path: string) {
	const stats = statSync(path);
	return { bytes: readFileSync(path), size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino };
}

async function indexed(path: string): Promise<SessionFileIndex | undefined> {
	const index = await indexSessionFile(path);
	if (index === "too_large") throw new Error(`${path} was refused as too large`);
	return index;
}

describe("reading a session file", () => {
	test("a v3 file is indexed by line, its entries read by span, and the file is left as it was", async () => {
		const builder = chat({ id: "s-v3", cwd: env.cwd, version: 3 });
		builder.custom("broski.origin", undefined, 500);
		const path = writeSession(env.sessionDir, builder);
		const before = snapshotOf(path);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const entries = await readEntries(index, index.entries);

		expect(index.version).toBe(3);
		expect(index.header).toMatchObject({ type: "session", id: "s-v3", cwd: env.cwd });
		expect(index.entries.map((span) => [span.entryId, span.type, span.role])).toEqual([
			["e0000001", "message", "user"],
			["e0000002", "message", "assistant"],
			["e0000003", "custom", undefined],
		]);
		expect(entries.map((entry) => entry?.id)).toEqual(["e0000001", "e0000002", "e0000003"]);
		expect(lastEntryId(index)).toBe("e0000003");
		expect(snapshotOf(path)).toEqual(before);
	});

	test("a v2 file keeps its own entry ids, and its hookMessage role reads as custom, in memory only", async () => {
		const builder = new SessionBuilder({ id: "s-v2", cwd: env.cwd, version: 2 });
		builder.user("hello", 1_000);
		builder.raw({
			type: "message",
			id: "h0000001",
			parentId: "e0000001",
			timestamp: "2026-03-01T10:00:02.000Z",
			message: { role: "hookMessage", customType: "x", content: "from a hook", display: true, timestamp: 1 },
		});
		const path = writeSession(env.sessionDir, builder);
		const before = snapshotOf(path);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const entries = await readEntries(index, index.entries);

		expect(index.version).toBe(2);
		expect(index.entries.map((span) => span.entryId)).toEqual(["e0000001", "h0000001"]);
		const hook = entries[1];
		expect(hook?.type === "message" && hook.message.role).toBe("custom");
		expect(snapshotOf(path)).toEqual(before);
	});

	test("a v2 file reads as Pi's own migration reads it (SessionManager.open on a copy)", async () => {
		const builder = new SessionBuilder({ id: "s-v2-parity", cwd: env.cwd, version: 2 });
		const first = builder.user("hello", 1_000);
		builder.raw({
			type: "message",
			id: "h0000001",
			parentId: first,
			timestamp: "2026-03-01T10:00:02.000Z",
			message: { role: "hookMessage", customType: "x", content: "from a hook", display: true, timestamp: 1 },
		});
		builder.assistant([textBlock("answer")], 3_000);
		const path = writeSession(env.sessionDir, builder);
		const copyDir = join(env.root, "copy");
		mkdirSync(copyDir);
		const copy = join(copyDir, "v2.jsonl");
		copyFileSync(path, copy);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const ours = await readEntries(index, index.entries);
		const theirs = SessionManager.open(copy, copyDir).getEntries();

		expect<unknown>(ours).toEqual(theirs);
	});

	test("a v1 file gets positional ids, and reads as Pi's own migration reads it apart from those ids", async () => {
		const builder = new SessionBuilder({ id: "s-v1", cwd: env.cwd });
		builder.user("hello", 1_000);
		builder.assistant([textBlock("answer")], 2_000);
		builder.raw({
			type: "compaction",
			timestamp: "2026-03-01T10:00:03.000Z",
			summary: "earlier",
			firstKeptEntryIndex: 2,
			tokensBefore: 10,
		});
		builder.user("again", 4_000);
		const path = writeSession(env.sessionDir, builder);
		const before = snapshotOf(path);
		const copyDir = join(env.root, "copy");
		mkdirSync(copyDir);
		const copy = join(copyDir, "v1.jsonl");
		copyFileSync(path, copy);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const ours = await readEntries(index, index.entries);
		const theirs = SessionManager.open(copy, copyDir).getEntries();

		expect(index.version).toBe(1);
		expect(index.entries.map((span) => [span.entryId, span.parentId])).toEqual([
			["l1", null],
			["l2", "l1"],
			["l3", "l2"],
			["l4", "l3"],
		]);
		expect(ours.map((entry) => entry?.id)).toEqual(["l1", "l2", "l3", "l4"]);
		expect(ours.map((entry) => entry?.parentId)).toEqual([null, "l1", "l2", "l3"]);
		const compaction = ours[2];
		expect(compaction?.type === "compaction" && compaction.firstKeptEntryId).toBe("l2");
		expect(ours.map(withoutIds)).toEqual(theirs.map(withoutIds));
		expect(snapshotOf(path)).toEqual(before);
	});

	test("U+2028 and U+2029 inside a message do not split the line (readline would)", async () => {
		const builder = new SessionBuilder({ id: "s-sep", cwd: env.cwd, version: 3 });
		builder.user("before\u2028middle\u2029after", 1_000);
		builder.assistant([textBlock("answer")], 2_000);
		const path = writeSession(env.sessionDir, builder);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const entries = await readEntries(index, index.entries);

		expect(readFileSync(path, "utf8")).toContain("\u2028");
		expect(index.entries).toHaveLength(2);
		const user = entries[0];
		expect(user?.type === "message" && user.message.role === "user" && user.message.content).toBe(
			"before\u2028middle\u2029after",
		);
	});

	test("a parent cycle, a self-parent and a missing parent end the walk instead of hanging", async () => {
		const builder = new SessionBuilder({ id: "s-cycle", cwd: env.cwd, version: 3 });
		builder.raw(entryLine("a0000001", "a0000002"));
		builder.raw(entryLine("a0000002", "a0000001"));
		builder.raw(entryLine("b0000001", "b0000001"));
		builder.raw(entryLine("c0000001", "does-not-exist"));
		const path = writeSession(env.sessionDir, builder);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");

		expect(branchTo(index, "a0000001").map((span) => span.entryId)).toEqual(["a0000002", "a0000001"]);
		expect(branchTo(index, "b0000001").map((span) => span.entryId)).toEqual(["b0000001"]);
		expect(branchTo(index, "c0000001").map((span) => span.entryId)).toEqual(["c0000001"]);
		expect(branchTo(index, "nope")).toEqual([]);
		expect(branchTo(index, null)).toEqual([]);
	});

	test("a last line with no newline is an entry only when it is complete JSON", async () => {
		const builder = chat({ id: "s-torn", cwd: env.cwd, version: 3 });
		const complete = writeSession(env.sessionDir, builder, { terminated: false });
		const completeIndex = await indexed(complete);
		expect(completeIndex?.entries).toHaveLength(2);

		const torn = join(env.sessionDir, "torn.jsonl");
		const whole = builder.text();
		writeFileSync(torn, whole.slice(0, whole.length - 20));
		const tornIndex = await indexed(torn);
		expect(tornIndex?.entries).toHaveLength(1);

		writeFileSync(torn, whole);
		expect((await indexed(torn))?.entries).toHaveLength(2);
	});

	test("what is not a Pi session file is not indexed", async () => {
		const empty = join(env.sessionDir, "empty.jsonl");
		writeFileSync(empty, "");
		const noHeader = join(env.sessionDir, "no-header.jsonl");
		writeFileSync(noHeader, `${JSON.stringify(entryLine("x0000001", null))}\n`);
		const prose = join(env.sessionDir, "prose.jsonl");
		writeFileSync(prose, "not json at all\n");

		expect(await indexed(empty)).toBeUndefined();
		expect(await indexed(noHeader)).toBeUndefined();
		expect(await indexed(prose)).toBeUndefined();
		expect(await indexed(join(env.sessionDir, "missing.jsonl"))).toBeUndefined();
	});

	test("blank and malformed lines before the header are skipped, as Pi skips them", async () => {
		const builder = chat({ id: "s-skip", cwd: env.cwd, version: 3 });
		const path = join(env.sessionDir, "skip.jsonl");
		writeFileSync(path, `\n{broken\n${builder.text()}`);

		const index = await indexed(path);
		expect(index?.header.id).toBe("s-skip");
		expect(index?.entries).toHaveLength(2);
	});

	test("a type Pi does not write is indexed for the chain but reads as nothing", async () => {
		const builder = chat({ id: "s-future", cwd: env.cwd, version: 3 });
		builder.raw({
			type: "from_the_future",
			id: "f0000001",
			parentId: "e0000002",
			timestamp: "2026-03-01T10:00:09.000Z",
		});
		const path = writeSession(env.sessionDir, builder);

		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");
		const entries = await readEntries(index, index.entries);

		expect(index.entries.map((span) => span.type)).toEqual(["message", "message", "from_the_future"]);
		expect(entries.map((entry) => entry?.id)).toEqual(["e0000001", "e0000002", undefined]);
	});

	test("a line whose entry changed under the index reads as nothing, not as another entry", async () => {
		const builder = chat({ id: "s-moved", cwd: env.cwd, version: 3 });
		const path = writeSession(env.sessionDir, builder);
		const index = await indexed(path);
		if (index === undefined) throw new Error("not indexed");

		writeFileSync(path, readFileSync(path, "utf8").replaceAll("e0000001", "f0000001"));

		const entries = await readEntries(index, index.entries);
		expect(entries.map((entry) => entry?.id)).toEqual([undefined, "e0000002"]);
	});

	test("a line without the usual first bytes is parsed, and a custom entry is read through its type", async () => {
		const builder = new SessionBuilder({ id: "s-order", cwd: env.cwd, version: 3 });
		builder.raw({
			id: "k0000001",
			type: "message",
			parentId: null,
			timestamp: "t",
			message: { role: "user", content: "x", timestamp: 1 },
		});
		builder.custom("some.extension", { n: 1 }, 10);
		const path = writeSession(env.sessionDir, builder);

		const index = await indexed(path);
		expect(index?.entries.map((span) => [span.entryId, span.type, span.role])).toEqual([
			["k0000001", "message", "user"],
			["e0000001", "custom", undefined],
		]);
	});

	test("the bytes of a real Pi run index exactly as Pi's own manager sees them", async () => {
		const { file } = await runPi(
			env,
			[
				{ thinking: ["Let me look."], text: ["Looking."], toolCalls: [{ name: "read", args: { path: "README.md" } }] },
				{ text: ["It is a project."] },
			],
			"What is in the README?",
		);
		const manager = SessionManager.open(file, dirname(file));

		const index = await indexed(file);
		if (index === undefined) throw new Error("not indexed");
		const ours = await readEntries(index, index.entries);

		expect(index.version).toBe(3);
		expect<unknown>(ours).toEqual(manager.getEntries());
		expect(index.entries.filter((span) => span.type === "message").every((span) => span.role !== undefined)).toBe(true);
		expect(branchTo(index, lastEntryId(index)).map((span) => span.entryId)).toEqual(
			manager.getBranch().map((entry) => entry.id),
		);
	});

	test("a 40 MB file is indexed in one pass with its bodies left unread", async () => {
		const builder = new SessionBuilder({ id: "s-big", cwd: env.cwd, version: 3 });
		const padding = "x".repeat(100_000);
		for (let turn = 0; turn < 400; turn += 1) {
			builder.user(`question ${turn}`, turn * 10);
			builder.assistant([textBlock(padding), toolCall(`call-${turn}`)], turn * 10 + 1);
		}
		const path = writeSession(env.sessionDir, builder);
		expect(statSync(path).size).toBeGreaterThan(40_000_000);

		Bun.gc(true);
		const heapBefore = process.memoryUsage().heapUsed;
		const started = performance.now();
		const index = await indexed(path);
		const elapsedMs = performance.now() - started;
		Bun.gc(true);
		const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

		expect(index?.entries).toHaveLength(800);
		expect(elapsedMs).toBeLessThan(3_000);
		expect(heapGrowth).toBeLessThan(25_000_000);
		const last = index?.entries.at(-1);
		const [entry] = index === undefined || last === undefined ? [] : await readEntries(index, [last]);
		expect(entry?.id).toBe("e0000800");
	});
});

function entryLine(id: string, parentId: string | null): object {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-03-01T10:00:00.000Z",
		message: { role: "user", content: userEntryText("x"), timestamp: 1 },
	};
}

function withoutIds(entry: unknown): unknown {
	if (typeof entry !== "object" || entry === null) return entry;
	const { id: _id, parentId: _parentId, firstKeptEntryId: _kept, ...rest } = entry as Record<string, unknown>;
	return rest;
}
