/** A search over the Pi listing: titles and folder names, every word, paged past a scan budget with no row lost. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LiveOverlay } from "../../backends/pi/ports";
import { listSessions } from "../../backends/pi/store/list";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { ToolChildren } from "../../backends/pi/store/tool-children";
import { type PageRequest, type SessionQuery, SessionsListResult } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, textBlock, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let index: SessionIndex;
let children: ToolChildren;

beforeEach(() => {
	env = createPiTestEnv();
	index = new SessionIndex(piSessionDirs(env.agentDir));
	children = new ToolChildren(index);
});

afterEach(() => {
	env.dispose();
});

const NOBODY: LiveOverlay = { row: () => undefined };

function chat(id: string, cwd: string, lastAt: number, prompt: string): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3, createdAt: lastAt - 10 });
	builder.user(prompt, lastAt - 5);
	builder.assistant([textBlock("answer")], lastAt);
	return builder;
}

async function page(query: SessionQuery, request: PageRequest) {
	const result = await listSessions(index, query, request, NOBODY, children);
	expect(SessionsListResult.safeParse(result).success).toBe(true);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page;
}

async function searched(search: string, limit: number): Promise<{ ids: string[]; pages: number }> {
	const ids: string[] = [];
	let cursor: string | undefined;
	let pages = 0;
	do {
		const next = await page({ search }, { limit, ...(cursor !== undefined && { cursor }) });
		ids.push(...next.items.map((row) => row.session.sessionId));
		cursor = next.nextCursor;
		pages += 1;
	} while (cursor !== undefined);
	return { ids, pages };
}

describe("searching the listing", () => {
	test("matches every word in the title or the folder's name, in any case, newest first", async () => {
		writeSession(env.sessionDir, chat("fix", env.cwd, 3_000, "Fix the login flow"));
		writeSession(env.sessionDir, chat("docs", env.cwd, 2_000, "Write the docs"));
		writeSession(env.sessionDir, chat("other", env.otherCwd, 1_000, "Fix the build"));
		const folder = env.cwd.split("/").at(-1) ?? "";

		expect((await searched("FIX", 200)).ids).toEqual(["fix", "other"]);
		expect((await searched(`fix ${folder}`, 200)).ids).toEqual(["fix"]);
		expect((await searched(folder.toUpperCase(), 200)).ids).toEqual(["fix", "docs"]);
		expect((await searched("fix docs", 200)).ids).toEqual([]);
		expect((await searched("fix", 1)).ids).toEqual(["fix", "other"]);
	});

	test("a cursor of one search is refused by another", async () => {
		for (const n of [1, 2, 3]) writeSession(env.sessionDir, chat(`s${n}`, env.cwd, n * 1_000, `task ${n}`));
		const first = await page({ search: "task" }, { limit: 1 });
		const result = await listSessions(
			index,
			{ search: "other" },
			{ limit: 1, cursor: first.nextCursor ?? "" },
			NOBODY,
			children,
		);
		expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
	});

	test("a match older than a page's scan budget is reached by the pages after it", async () => {
		const old = chat("needle", env.cwd, 1_000, "the rare needle");
		writeSession(env.sessionDir, old);
		for (let n = 0; n < 2_100; n += 1) writeSession(env.sessionDir, chat(`hay${n}`, env.cwd, 10_000 + n, "hay"));
		const found = await searched("needle", 50);
		expect(found.ids).toEqual(["needle"]);
		expect(found.pages).toBeGreaterThan(1);
	}, 60_000);
});

describe("a first prompt's title", () => {
	test("is one line of at most 200 characters, and says it was cut", async () => {
		const prompt = `${"word ".repeat(300)}\n\nsecond paragraph`;
		writeSession(env.sessionDir, chat("long", env.cwd, 1_000, prompt));
		writeSession(env.sessionDir, chat("short", env.cwd, 2_000, "Short\nand two lines"));
		const rows = (await page({}, { limit: 10 })).items;
		const long = rows.find((row) => row.session.sessionId === "long")?.title?.text ?? "";
		expect(long.endsWith("…")).toBe(true);
		expect(long.length).toBeLessThanOrEqual(201);
		expect(long.includes("\n")).toBe(false);
		expect(rows.find((row) => row.session.sessionId === "short")?.title?.text).toBe("Short and two lines");
	});
});
