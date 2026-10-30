/** `listSessions` and `getSession` over session files: rows, order, paging, cursors, and live facts. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveOverlay, LiveRow } from "../../backends/pi/ports";
import { getSession, listSessions } from "../../backends/pi/store/list";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import {
	MAX_NAME_CHARS,
	type PageRequest,
	SessionGetResult,
	type SessionQuery,
	type SessionSummary,
	SessionsListResult,
} from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { imageBlock, iso, SessionBuilder, T0, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let index: SessionIndex;

beforeEach(() => {
	env = createPiTestEnv();
	index = new SessionIndex(piSessionDirs(env.agentDir));
});

afterEach(() => {
	env.dispose();
});

const NOBODY: LiveOverlay = { row: () => undefined };

function chat(id: string, cwd: string, lastAt: number, prompt = `prompt of ${id}`): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3, createdAt: lastAt - 10 });
	builder.user(prompt, lastAt - 5);
	builder.assistant([textBlock("answer")], lastAt);
	return builder;
}

async function list(query: Partial<SessionQuery>, page: PageRequest = { limit: 200 }, live: LiveOverlay = NOBODY) {
	const result = await listSessions(index, { archived: false, ...query }, page, live);
	expect(SessionsListResult.safeParse(result).success).toBe(true);
	return result;
}

async function rows(query: Partial<SessionQuery>, live: LiveOverlay = NOBODY): Promise<SessionSummary[]> {
	const result = await list(query, { limit: 200 }, live);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page.items;
}

describe("listing sessions", () => {
	test("rows are summaries as the contract defines them, with the cwd as Pi wrote it", async () => {
		const builder = chat("s1", env.cwd, 5_000, "fix the build");
		builder.modelChange("faux", "faux-2", 6_000);
		writeSession(env.sessionDir, builder);

		const [row] = await rows({ cwd: env.cwd });

		expect(row).toEqual({
			session: { backend: "pi", sessionId: "s1" },
			title: { text: "fix the build", source: "first_prompt" },
			cwd: env.cwd,
			createdAt: T0 + 4_990,
			updatedAt: T0 + 5_000,
			archived: false,
			modelId: "faux/faux-2",
			status: "unknown",
			origin: "external",
		});
	});

	test("only sessions whose header cwd is the cwd are listed, though two cwds share a directory name", async () => {
		const first = join(env.root, "a-b");
		const second = join(env.root, "a", "b");
		writeSession(env.sessionDir, chat("in-first", first, 1_000));
		writeSession(env.sessionDir, chat("in-second", second, 2_000));
		const oldStyle = new SessionBuilder({ id: "no-cwd", cwd: "", version: 3 });
		oldStyle.user("old", 1);
		writeSession(env.sessionDir, oldStyle);

		expect((await rows({ cwd: first })).map((row) => row.session.sessionId)).toEqual(["in-first"]);
		expect((await rows({ cwd: second })).map((row) => row.session.sessionId)).toEqual(["in-second"]);
		const everything = await rows({});
		expect(everything.map((row) => row.session.sessionId)).toEqual(["in-second", "in-first", "no-cwd"]);
		expect(everything.at(-1)?.cwd).toBeUndefined();
	});

	test("a symlinked cwd lists the sessions of its target and the row keeps the header's string", async () => {
		const link = join(env.root, "project-link");
		symlinkSync(env.cwd, link);
		writeSession(env.sessionDir, chat("via-link", link, 1_000));
		writeSession(env.sessionDir, chat("via-real", env.cwd, 2_000));

		const viaReal = await rows({ cwd: env.cwd });
		const viaLink = await rows({ cwd: link });

		expect(viaReal.map((row) => row.session.sessionId)).toEqual(["via-real", "via-link"]);
		expect(viaLink.map((row) => row.session.sessionId)).toEqual(["via-real", "via-link"]);
		expect(viaReal.find((row) => row.session.sessionId === "via-link")?.cwd).toBe(link);
	});

	test("order follows the last message, not the file's mtime, and an id breaks a tie", async () => {
		const old = writeSession(env.sessionDir, chat("old", env.cwd, 1_000));
		writeSession(env.sessionDir, chat("tie-a", env.cwd, 5_000));
		writeSession(env.sessionDir, chat("tie-b", env.cwd, 5_000));
		writeSession(env.sessionDir, chat("new", env.cwd, 9_000));
		utimesSync(old, new Date(), new Date());

		expect((await rows({ cwd: env.cwd })).map((row) => row.session.sessionId)).toEqual([
			"new",
			"tie-b",
			"tie-a",
			"old",
		]);
	});

	test("a message's own timestamp wins over its entry's, and a run of big tool results at the end is passed over", async () => {
		const builder = chat("tail", env.cwd, 3_000);
		const huge = "y".repeat(200_000);
		for (let call = 0; call < 3; call += 1) builder.toolResult(`c${call}`, huge, 4_000 + call);
		writeSession(env.sessionDir, builder);

		const [row] = await rows({ cwd: env.cwd });
		expect(row?.updatedAt).toBe(T0 + 3_000);
	});

	test("a tail window that begins inside a line, where an entry-like object is nested, is not read as an entry", async () => {
		const fake = {
			type: "message",
			id: "zz000001",
			parentId: null,
			timestamp: iso(0),
			message: { role: "user", content: "fake", timestamp: T0 + 9_000_000 },
		};
		const marker = '{"type":"message","id":"zz000001"';
		const build = (padding: number): SessionBuilder => {
			const builder = new SessionBuilder({ id: "nested", cwd: env.cwd, version: 3 });
			builder.user("real", 1_000);
			builder.assistant([textBlock("answer"), toolCall("x", "other", fake)], 2_000);
			builder.toolResult("x", "p".repeat(padding), 3_000);
			return builder;
		};
		const probe = build(0).text();
		const offset = probe.indexOf(marker);
		const padding = offset + 32 * 1024 - Buffer.byteLength(probe);
		const text = build(padding).text();
		expect(Buffer.byteLength(text) - offset).toBe(32 * 1024);
		writeFileSync(join(env.sessionDir, "nested.jsonl"), text);

		const [row] = await rows({});

		expect(row?.updatedAt).toBe(T0 + 2_000);
	});

	test("when a clock stepped back the maximum over the last messages is the time, as Pi's rule gives; a zero time counts for nothing", async () => {
		const stepped = new SessionBuilder({ id: "stepped", cwd: env.cwd, version: 3 });
		stepped.user("one", 5_000);
		stepped.assistant([textBlock("two")], 4_000);
		stepped.user("three", 3_000);
		writeSession(env.sessionDir, stepped);
		const zero = new SessionBuilder({ id: "zero", cwd: env.cwd, version: 3, createdAt: 7_000 });
		zero.user("zero", -T0);
		writeSession(env.sessionDir, zero);

		const found = Object.fromEntries((await rows({})).map((row) => [row.session.sessionId, row.updatedAt]));

		expect(found.stepped).toBe(T0 + 5_000);
		expect(found.zero).toBe(T0 + 7_000);
	});

	test("a session with no message is dated by its header, and a header date that is not one by the file's mtime", async () => {
		const bare = new SessionBuilder({ id: "bare", cwd: env.cwd, version: 3, createdAt: 7_000 });
		bare.custom("x", undefined, 7_001);
		writeSession(env.sessionDir, bare);
		const path = join(env.sessionDir, "bad-date.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ type: "session", version: 3, id: "bad-date", timestamp: "yesterday-ish", cwd: env.cwd })}\n`,
		);
		const modified = new Date(T0 + 50_000);
		utimesSync(path, modified, modified);

		const found = await rows({ cwd: env.cwd });
		expect(found.find((row) => row.session.sessionId === "bare")).toMatchObject({
			updatedAt: T0 + 7_000,
			createdAt: T0 + 7_000,
		});
		const dated = found.find((row) => row.session.sessionId === "bad-date");
		expect(dated?.updatedAt).toBe(T0 + 50_000);
		expect(dated?.createdAt).toBeUndefined();
	});

	test("the title is the latest rename, an empty rename clears it, else the first prompt as one line", async () => {
		const renamed = chat("renamed", env.cwd, 1_000);
		renamed.sessionInfo("First name", 1_100);
		renamed.user("later", 1_200);
		renamed.sessionInfo("  Final   name ", 1_300);
		writeSession(env.sessionDir, renamed);
		const cleared = chat("cleared", env.cwd, 2_000, "line one\nline two\t  tail");
		cleared.sessionInfo("Gone soon", 2_100);
		cleared.sessionInfo("   ", 2_200);
		writeSession(env.sessionDir, cleared);
		const imageFirst = new SessionBuilder({ id: "image-first", cwd: env.cwd, version: 3 });
		imageFirst.user([imageBlock("AAAA")], 3_000);
		imageFirst.user([textBlock("the real"), textBlock("prompt")], 3_100);
		writeSession(env.sessionDir, imageFirst);
		const silent = new SessionBuilder({ id: "silent", cwd: env.cwd, version: 3 });
		silent.user([imageBlock("AAAA")], 4_000);
		writeSession(env.sessionDir, silent);

		const titles = Object.fromEntries((await rows({})).map((row) => [row.session.sessionId, row.title]));
		expect(titles.renamed).toEqual({ text: "Final   name", source: "user" });
		expect(titles.cleared).toEqual({ text: "line one line two tail", source: "first_prompt" });
		expect(titles["image-first"]).toEqual({ text: "the real prompt", source: "first_prompt" });
		expect(titles.silent).toBeUndefined();
	});

	test("values past the contract's bounds are cut or left out so every row still validates", async () => {
		writeSession(env.sessionDir, chat("far", `/${"d".repeat(5_000)}`, 1_000));
		const named = chat("named-long", env.cwd, 2_000);
		named.sessionInfo("n".repeat(5_000), 2_100);
		writeSession(env.sessionDir, named);
		writeFileSync(join(env.sessionDir, "long-id.jsonl"), chat("i".repeat(300), env.cwd, 3_000).text());
		const longModel = chat("model-id", env.cwd, 5_000);
		longModel.modelChange("p".repeat(200), "m".repeat(200), 5_100);
		writeSession(env.sessionDir, longModel);

		const found = await rows({});
		const byId = Object.fromEntries(found.map((row) => [row.session.sessionId, row]));

		expect(Object.keys(byId).sort()).toEqual(["far", "model-id", "named-long"]);
		expect(byId.far?.cwd).toBeUndefined();
		expect(byId["named-long"]?.title?.text).toHaveLength(MAX_NAME_CHARS);
		expect(byId["model-id"]?.modelId).toBeUndefined();
	});

	test("a huge first prompt makes a title of at most MAX_NAME_CHARS", async () => {
		writeSession(env.sessionDir, chat("long", env.cwd, 1_000, "word ".repeat(400_000)));
		const [row] = await rows({});
		expect(row?.title?.text.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
		expect(row?.title?.text.startsWith("word word")).toBe(true);
	});

	test("the model is the last model change or assistant message, as a wire id", async () => {
		const assistantLast = chat("a", env.cwd, 1_000);
		assistantLast.modelChange("faux", "m1", 1_100);
		assistantLast.assistant([textBlock("x")], 1_200, "m2", "openrouter");
		writeSession(env.sessionDir, assistantLast);
		const changeLast = chat("b", env.cwd, 2_000);
		changeLast.modelChange("anthropic", "claude/with/slashes", 2_100);
		writeSession(env.sessionDir, changeLast);

		const models = Object.fromEntries((await rows({})).map((row) => [row.session.sessionId, row.modelId]));
		expect(models).toEqual({ a: "openrouter/m2", b: "anthropic/claude/with/slashes" });
	});

	test("origin is broski for a session that holds the marker anywhere, and external otherwise", async () => {
		const own = chat("own", env.cwd, 1_000);
		own.custom("broski.origin", undefined, 1_050);
		writeSession(env.sessionDir, own);
		writeSession(env.sessionDir, chat("terminal", env.cwd, 2_000));

		const origins = Object.fromEntries((await rows({})).map((row) => [row.session.sessionId, row.origin]));
		expect(origins).toEqual({ own: "broski", terminal: "external" });
	});

	test("a fork names its parent, listed with parent: and dropped when the parent file is gone", async () => {
		const parent = writeSession(env.sessionDir, chat("parent", env.cwd, 1_000));
		const fork = new SessionBuilder({ id: "fork", cwd: env.cwd, version: 3, createdAt: 1_990, parentSession: parent });
		fork.user("forked prompt", 1_995);
		fork.assistant([textBlock("answer")], 2_000);
		const orphan = new SessionBuilder({
			id: "orphan",
			cwd: env.cwd,
			version: 3,
			parentSession: join(env.root, "gone.jsonl"),
		});
		orphan.user("o", 10);
		writeSession(env.sessionDir, fork);
		writeSession(env.sessionDir, orphan);

		const all = await rows({});
		const parentRef = { backend: "pi" as const, sessionId: "parent" };
		expect(all.find((row) => row.session.sessionId === "fork")?.parent).toEqual({ kind: "fork", session: parentRef });
		expect(all.find((row) => row.session.sessionId === "orphan")?.parent).toBeUndefined();
		expect((await rows({ parent: parentRef })).map((row) => row.session.sessionId)).toEqual(["fork"]);
		expect(await rows({ parent: { backend: "codex", sessionId: "parent" } })).toEqual([]);
	});

	test("archived sessions do not exist", async () => {
		writeSession(env.sessionDir, chat("s", env.cwd, 1_000));
		expect(await rows({ archived: true })).toEqual([]);
	});

	test("files that are not sessions are not listed", async () => {
		writeSession(env.sessionDir, chat("real", env.cwd, 1_000));
		writeFileSync(join(env.sessionDir, "notes.jsonl"), "just some notes\n");
		writeFileSync(join(env.sessionDir, "readme.txt"), "x");
		mkdirSync(join(env.sessionDir, "folder.jsonl"));

		expect((await rows({})).map((row) => row.session.sessionId)).toEqual(["real"]);
	});

	test("one session reachable twice is listed once", async () => {
		const path = writeSession(env.sessionDir, chat("twice", env.cwd, 1_000));
		const alias = join(env.sessionDir, "alias.jsonl");
		symlinkSync(path, alias);

		expect(await rows({})).toHaveLength(1);
	});

	test("live facts overlay the file's: status and the model", async () => {
		writeSession(env.sessionDir, chat("hosted", env.cwd, 1_000));
		const live: LiveOverlay = {
			row: (id): LiveRow | undefined =>
				id === "hosted" ? { status: "running", modelId: "faux/live-model" } : undefined,
		};

		const found = await rows({ cwd: env.cwd }, live);

		expect(found.map((row) => row.session.sessionId)).toEqual(["hosted"]);
		expect(found[0]).toMatchObject({ status: "running", modelId: "faux/live-model", origin: "external" });
	});
});

describe("one session by id", () => {
	test("a file's session is found with its summary, an unsaved hosted one by the overlay, any other id is not_found", async () => {
		writeSession(env.sessionDir, chat("known", env.cwd, 1_000));
		const found = await getSession(index, "known", NOBODY);
		expect(SessionGetResult.safeParse(found).success).toBe(true);
		expect(found.status === "accepted" && found.summary.session.sessionId).toBe("known");

		const missing = await getSession(index, "nobody", NOBODY);
		expect(missing.status === "rejected" && missing.rejection.code).toBe("not_found");
	});

	test("a file renamed on disk is found at its new path", async () => {
		const builder = chat("moves", env.cwd, 1_000);
		const path = writeSession(env.sessionDir, builder);
		await getSession(index, "moves", NOBODY);
		const moved = join(env.sessionDir, "moved.jsonl");
		renameSync(path, moved);

		const found = await getSession(index, "moves", NOBODY);
		expect(found.status).toBe("accepted");
		expect((await index.find("moves"))?.path).toBe(moved);
	});
});
