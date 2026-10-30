/**
 * Rename, delete and fork of sessions nobody hosts. Deleting goes through a fake `trash` command first on
 * PATH, so no test ever touches the user's Trash.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay } from "../../backends/pi/ports";
import { sessionName } from "../../backends/pi/session-name";
import { NO_LIVE } from "../../backends/pi/store/list";
import { forkStored, type MutationDeps, renameStored } from "../../backends/pi/store/mutations";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { readTranscript } from "../../backends/pi/store/transcript";
import { ActionResult, type CatalogEvent, type ForkPoint, NewSessionResult, SessionSummary } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { itemsOfEntryStub, SessionBuilder, T0, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let index: SessionIndex;
let events: CatalogEvent[];
let deps: MutationDeps;
let clock: number;

/** A rename as the backend makes it: the title checked once (`sessionName`), then appended. */
async function rename(sessionId: string, title: string): Promise<ActionResult> {
	const name = sessionName(title);
	return typeof name === "string" ? renameStored(deps, sessionId, name) : name;
}

beforeEach(() => {
	env = createPiTestEnv();
	events = [];
	clock = T0 + 1_000_000;
	const dirs = piSessionDirs(env.agentDir);
	index = new SessionIndex(dirs);
	deps = {
		index,
		dirs,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		now: () => clock,
		itemsOf: itemsOfEntryStub,
	};
});

afterEach(() => {
	mock.restore();
	env.dispose();
});

function conversation(id: string, version: 2 | 3 = 3): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, version });
	builder.user("question", 100);
	builder.assistant([textBlock("thinking aloud"), textBlock("an answer"), toolCall("c1")], 200);
	builder.toolResult("c1", "result", 300);
	builder.assistant([textBlock("final")], 400);
	return builder;
}

function linesOf(path: string): string[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.length > 0);
}

function onlyEvent<T extends CatalogEvent["type"]>(type: T): Extract<CatalogEvent, { type: T }> {
	const found = events.filter((event): event is Extract<CatalogEvent, { type: T }> => event.type === type);
	expect(found).toHaveLength(1);
	const [event] = found;
	if (event === undefined) throw new Error(`no ${type}`);
	return event;
}

async function transcriptKinds(id: string, live: LiveOverlay = NO_LIVE): Promise<string[]> {
	const result = await readTranscript(index, id, { limit: 200 }, live, itemsOfEntryStub);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page.items.map((item) => item.kind);
}

describe("renaming a stored session", () => {
	test("appends one session_info line under the last entry and announces the new title", async () => {
		const path = writeSession(env.sessionDir, conversation("r1"));
		const before = readFileSync(path, "utf8");

		const result = await rename("r1", " A new\r\nname ");

		expect(result).toEqual({ status: "accepted" });
		expect(ActionResult.safeParse(result).success).toBe(true);
		expect(ActionResult.safeParse(await rename("nobody", "x")).success).toBe(true);
		const text = readFileSync(path, "utf8");
		expect(text.startsWith(before)).toBe(true);
		const added = text.slice(before.length);
		expect(added.endsWith("\n")).toBe(true);
		const entry = JSON.parse(added);
		expect(entry).toMatchObject({ type: "session_info", parentId: "e0000004", name: "A new name" });
		expect(entry.id).toMatch(/^[0-9a-f]{8}$/);
		expect(entry.timestamp).toBe(new Date(clock).toISOString());
		const summary = onlyEvent("session_updated").summary;
		expect(SessionSummary.safeParse(summary).success).toBe(true);
		expect(summary.title).toEqual({ text: "A new name", source: "user" });
	});

	test("Pi's own manager reads the name back (SessionManager.open on a copy)", async () => {
		const path = writeSession(env.sessionDir, conversation("r2"));
		await rename("r2", "Named by the phone");
		const copyDir = join(env.root, "copy");
		mkdirSync(copyDir);
		const copy = join(copyDir, "r2.jsonl");
		copyFileSync(path, copy);

		const manager = SessionManager.open(copy, copyDir);

		expect(manager.getSessionName()).toBe("Named by the phone");
		expect(manager.getEntries().at(-1)?.type).toBe("session_info");
	});

	test("a file whose last line has no newline gets one before the new line", async () => {
		const path = writeSession(env.sessionDir, conversation("r3"), { terminated: false });

		await rename("r3", "x");

		const lines = linesOf(path);
		expect(lines).toHaveLength(6);
		expect(JSON.parse(lines[5] ?? "").type).toBe("session_info");
	});

	test("a v1 file's new line is rooted, since it has no ids to hang from", async () => {
		const builder = new SessionBuilder({ id: "r4", cwd: env.cwd });
		builder.user("old", 10);
		const path = writeSession(env.sessionDir, builder);

		await rename("r4", "x");

		expect(JSON.parse(linesOf(path).at(-1) ?? "").parentId).toBeNull();
	});

	test("an empty name, a name past the bound and an unknown session are refused, and nothing is written", async () => {
		const path = writeSession(env.sessionDir, conversation("r5"));
		const before = readFileSync(path, "utf8");

		const empty = await rename("r5", " \r\n ");
		const long = await rename("r5", "n".repeat(1_025));
		const unknown = await rename("nobody", "x");

		expect(empty.status === "rejected" && empty.rejection.code).toBe("invalid_input");
		expect(long.status === "rejected" && long.rejection.code).toBe("invalid_input");
		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(events).toEqual([]);
	});

	test("a file deleted since it was found is not created again", async () => {
		const path = writeSession(env.sessionDir, conversation("r6"));
		await index.find("r6");
		rmSync(path);

		const result = await rename("r6", "x");

		expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
		expect(existsSync(path)).toBe(false);
	});

	test("a file deleted between reading it and appending to it is not_found, and is not created again", async () => {
		const path = writeSession(env.sessionDir, conversation("r7"));
		const real = index.fileIndex.bind(index);
		spyOn(index, "fileIndex").mockImplementation(async (target) => {
			const file = await real(target);
			rmSync(path);
			return file;
		});

		const result = await rename("r7", "x");

		expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
		expect(existsSync(path)).toBe(false);
	});
});

describe("forking a stored session", () => {
	async function fork(sessionId: string, at?: ForkPoint, live: LiveOverlay = NO_LIVE) {
		const result = await forkStored(deps, sessionId, at, live);
		expect(NewSessionResult.safeParse(result).success).toBe(true);
		return result;
	}

	async function forked(sessionId: string, at?: ForkPoint, live: LiveOverlay = NO_LIVE): Promise<string> {
		const result = await fork(sessionId, at, live);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		return result.session.sessionId;
	}

	test("the whole session: a new v3 file naming its source, the same history, the bridge's origin, the source untouched", async () => {
		const sourcePath = writeSession(env.sessionDir, conversation("f1"));
		const sourceBefore = readFileSync(sourcePath, "utf8");

		const id = await forked("f1");

		const found = await index.find(id);
		if (found === undefined) throw new Error("fork not found");
		const lines = linesOf(found.path);
		expect(JSON.parse(lines[0] ?? "")).toMatchObject({
			type: "session",
			version: 3,
			id,
			cwd: env.cwd,
			parentSession: sourcePath,
		});
		expect(found.path.endsWith(`_${id}.jsonl`)).toBe(true);
		expect(dirname(found.path)).toBe(env.sessionDir);
		expect(readdirSync(env.sessionDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
		expect(JSON.parse(lines[1] ?? "")).toMatchObject({ type: "custom", customType: "broski.origin", parentId: null });
		expect(JSON.parse(lines[2] ?? "")).toMatchObject({ id: "e0000001", parentId: JSON.parse(lines[1] ?? "").id });
		expect(lines.slice(3)).toEqual(linesOf(sourcePath).slice(2));
		expect(readFileSync(sourcePath, "utf8")).toBe(sourceBefore);
		expect(await transcriptKinds(id)).toEqual(await transcriptKinds("f1"));
		const summary = onlyEvent("session_updated").summary;
		expect(SessionSummary.safeParse(summary).success).toBe(true);
		expect(summary).toMatchObject({
			session: { sessionId: id },
			origin: "broski",
			parent: { kind: "fork", session: { sessionId: "f1" } },
		});
	});

	test("Pi's own manager opens the fork as one tree ending on the copied branch (SessionManager.open on a copy)", async () => {
		writeSession(env.sessionDir, conversation("f2"));
		const id = await forked("f2");
		const path = (await index.find(id))?.path ?? "";
		const copyDir = join(env.root, "copy");
		mkdirSync(copyDir);
		const copy = join(copyDir, "fork.jsonl");
		copyFileSync(path, copy);

		const manager = SessionManager.open(copy, copyDir);

		expect(manager.getSessionId()).toBe(id);
		expect(manager.getHeader()?.parentSession).toContain("f2");
		expect(manager.getTree()).toHaveLength(1);
		expect(manager.getBranch().map((entry) => entry.type)).toEqual([
			"custom",
			"message",
			"message",
			"message",
			"message",
		]);
		expect(manager.getLeafId()).toBe("e0000004");
		const sourceCopy = join(copyDir, "source.jsonl");
		copyFileSync(
			join(env.sessionDir, readdirSync(env.sessionDir).find((name) => name.includes("_f2.jsonl")) ?? ""),
			sourceCopy,
		);
		const source = SessionManager.open(sourceCopy, copyDir).getBranch();
		expect(
			manager
				.getBranch()
				.slice(1)
				.map((entry) => ({ ...entry, parentId: null })),
		).toEqual(source.map((entry) => ({ ...entry, parentId: null })));
		expect(manager.getBranch()[1]?.parentId).toBe(manager.getBranch()[0]?.id);
	});

	test("through the last item of a message keeps everything up to it; the fork's transcript ends there", async () => {
		writeSession(env.sessionDir, conversation("f3"));

		const id = await forked("f3", { itemId: "e0000002:2", position: "through" });

		expect(await transcriptKinds(id)).toEqual(["tool_call", "block", "block", "user_message"]);
	});

	test("before the first item of a message ends at the entry before it, and before the first message gives an empty fork", async () => {
		writeSession(env.sessionDir, conversation("f4"));

		const beforeAnswer = await forked("f4", { itemId: "e0000002:0", position: "before" });
		const beforeFirst = await forked("f4", { itemId: "e0000001:0", position: "before" });

		expect(await transcriptKinds(beforeAnswer)).toEqual(["user_message"]);
		expect(await transcriptKinds(beforeFirst)).toEqual([]);
		const path = (await index.find(beforeFirst))?.path ?? "";
		expect(linesOf(path)).toHaveLength(2);
	});

	test("a point inside a message is invalid_input, an unknown or off-branch item is not_found", async () => {
		const builder = conversation("f5");
		builder.branchFrom("e0000002");
		builder.user("abandoned branch", 500);
		builder.branchFrom("e0000004");
		writeSession(env.sessionDir, builder);
		const attempts: [ForkPoint, "invalid_input" | "not_found"][] = [
			[{ itemId: "e0000002:1", position: "through" }, "invalid_input"],
			[{ itemId: "e0000002:1", position: "before" }, "invalid_input"],
			[{ itemId: "e0000002:9", position: "through" }, "not_found"],
			[{ itemId: "zzzzzzzz:0", position: "through" }, "not_found"],
			[{ itemId: "garbage", position: "through" }, "not_found"],
		];

		for (const [point, code] of attempts) {
			const result = await fork("f5", point);
			expect(result.status === "rejected" && result.rejection.code).toBe(code);
		}
		expect(events).toEqual([]);
		expect(readdirSync(env.sessionDir)).toHaveLength(1);
	});

	test("the branch the transcript shows is what is forked: the live cut while a run is active", async () => {
		writeSession(env.sessionDir, conversation("f6"));
		const cut: LiveOverlay = {
			row: () => ({ status: "running", cut: { leafEntryId: "e0000002" } }),
		};

		const id = await forked("f6", undefined, cut);

		expect(await transcriptKinds(id)).toEqual(["tool_call", "block", "block", "user_message"]);
	});

	test("a fork of a session this bridge made keeps its single origin entry; a fork of a fork does too", async () => {
		const builder = new SessionBuilder({ id: "f7", cwd: env.cwd, version: 3 });
		builder.custom("broski.origin", undefined, 50);
		builder.user("hi", 100);
		builder.assistant([textBlock("hello")], 200);
		writeSession(env.sessionDir, builder);

		const first = await forked("f7");
		const second = await forked(first);

		for (const id of [first, second]) {
			const lines = linesOf((await index.find(id))?.path ?? "");
			expect(lines.filter((line) => line.includes("broski.origin"))).toHaveLength(1);
		}
	});

	test("an older file is forked as a migrated v3 file, with Pi's own reading of it unchanged", async () => {
		const v2 = new SessionBuilder({ id: "f8", cwd: env.cwd, version: 2 });
		v2.user("hello", 10);
		v2.raw({
			type: "message",
			id: "h0000001",
			parentId: "e0000001",
			timestamp: "2026-03-01T10:00:02.000Z",
			message: { role: "hookMessage", customType: "x", content: "hook", display: true, timestamp: 1 },
		});
		writeSession(env.sessionDir, v2);
		const v1 = new SessionBuilder({ id: "f9", cwd: env.cwd });
		v1.user("old", 10);
		v1.assistant([textBlock("older")], 20);
		writeSession(env.sessionDir, v1);

		const fromV2 = await forked("f8");
		const fromV1 = await forked("f9");

		const v2Lines = linesOf((await index.find(fromV2))?.path ?? "").map((line) => JSON.parse(line));
		expect(v2Lines[0].version).toBe(3);
		expect(v2Lines[3].message.role).toBe("custom");
		const v1Lines = linesOf((await index.find(fromV1))?.path ?? "").map((line) => JSON.parse(line));
		expect(v1Lines.slice(2).map((entry) => [entry.id, entry.parentId])).toEqual([
			["l1", v1Lines[1].id],
			["l2", "l1"],
		]);
		expect(await transcriptKinds(fromV1)).toEqual(["block", "user_message"]);
	});

	test("an unknown session is refused", async () => {
		const unknown = await fork("nobody");

		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
		expect(events).toEqual([]);
	});

	test("two forks made in the same millisecond are two files", async () => {
		writeSession(env.sessionDir, conversation("f10"));

		const [first, second] = await Promise.all([forked("f10"), forked("f10")]);

		expect(first).not.toBe(second);
		expect(readdirSync(env.sessionDir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(3);
	});
});
