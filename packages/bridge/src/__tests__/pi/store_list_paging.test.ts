/** A listing paged with its keyset cursor: newest first, no repeat or gap, and a cursor this listing did not mint refused. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { LiveOverlay } from "../../backends/pi/ports";
import { listSessions } from "../../backends/pi/store/list";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { ToolChildren } from "../../backends/pi/store/tool-children";
import { type PageRequest, type SessionQuery, type SessionSummary, SessionsListResult } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { SessionBuilder, T0, textBlock, writeSession } from "./store_fixtures";

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

function chat(id: string, cwd: string, lastAt: number, prompt = `prompt of ${id}`): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd, version: 3, createdAt: lastAt - 10 });
	builder.user(prompt, lastAt - 5);
	builder.assistant([textBlock("answer")], lastAt);
	return builder;
}

async function list(query: Partial<SessionQuery>, page: PageRequest = { limit: 200 }, live: LiveOverlay = NOBODY) {
	const result = await listSessions(index, { archived: false, ...query }, page, live, children);
	expect(SessionsListResult.safeParse(result).success).toBe(true);
	return result;
}

async function rows(query: Partial<SessionQuery>, live: LiveOverlay = NOBODY): Promise<SessionSummary[]> {
	const result = await list(query, { limit: 200 }, live);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page.items;
}

describe("paging a listing", () => {
	async function ids(page: PageRequest, query: Partial<SessionQuery> = {}): Promise<{ ids: string[]; next?: string }> {
		const result = await list(query, page);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		return { ids: result.page.items.map((row) => row.session.sessionId), next: result.page.nextCursor };
	}

	test("pages of two concatenate to the one-page listing, and the last page has no cursor", async () => {
		for (let n = 0; n < 7; n += 1) writeSession(env.sessionDir, chat(`s${n}`, env.cwd, 1_000 + (n % 3) * 1_000));
		const whole = await ids({ limit: 200 }, { cwd: env.cwd });

		const paged: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await ids({ limit: 2, ...(cursor !== undefined && { cursor }) }, { cwd: env.cwd });
			expect(page.ids.length).toBeLessThanOrEqual(2);
			paged.push(...page.ids);
			cursor = page.next;
		} while (cursor !== undefined);

		expect(paged).toEqual(whole.ids);
		expect(whole.ids).toHaveLength(7);
		expect(whole.next).toBeUndefined();
	});

	test("a cursor the listing did not mint is invalid_input, whatever it looks like", async () => {
		for (let n = 0; n < 4; n += 1) writeSession(env.sessionDir, chat(`s${n}`, env.cwd, 1_000 + n));
		const first = await ids({ limit: 1 }, { cwd: env.cwd });
		const minted = first.next ?? "";
		const forged = Buffer.from(JSON.stringify([1, "x"])).toString("base64url");

		const refused = [
			"not-a-cursor",
			forged,
			Buffer.from(JSON.stringify({ v: 1, k: "sessions", s: "x", p: [1, "x"] })).toString("base64url"),
		];
		for (const cursor of refused) {
			const result = await listSessions(
				index,
				{ archived: false, cwd: env.cwd },
				{ limit: 1, cursor },
				NOBODY,
				children,
			);
			expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
		const elsewhere = await listSessions(
			index,
			{ archived: false, cwd: env.otherCwd },
			{ limit: 1, cursor: minted },
			NOBODY,
			children,
		);
		expect(elsewhere.status === "rejected" && elsewhere.rejection.code).toBe("invalid_input");
		const archived = await listSessions(
			index,
			{ archived: true, cwd: env.cwd },
			{ limit: 1, cursor: minted },
			NOBODY,
			children,
		);
		expect(archived.status === "rejected" && archived.rejection.code).toBe("invalid_input");
	});

	test("a session written by another process appears in the next listing, and a changed one moves", async () => {
		writeSession(env.sessionDir, chat("first", env.cwd, 1_000));
		expect((await rows({})).map((row) => row.session.sessionId)).toEqual(["first"]);

		const second = chat("second", env.cwd, 2_000);
		writeSession(env.sessionDir, second);
		expect((await rows({})).map((row) => row.session.sessionId)).toEqual(["second", "first"]);

		const grown = chat("first", env.cwd, 1_000);
		grown.user("one more", 8_000);
		grown.assistant([textBlock("done")], 9_000);
		writeSession(env.sessionDir, grown);
		const after = await rows({});
		expect(after.map((row) => row.session.sessionId)).toEqual(["first", "second"]);
		expect(after[0]?.updatedAt).toBe(T0 + 9_000);
	});

	test("a deleted file leaves the listing", async () => {
		const path = writeSession(env.sessionDir, chat("gone", env.cwd, 1_000));
		writeSession(env.sessionDir, chat("stays", env.cwd, 2_000));
		await rows({});
		rmSync(path);

		expect((await rows({})).map((row) => row.session.sessionId)).toEqual(["stays"]);
	});

	test("300 sessions list and page in bounded time", async () => {
		for (let n = 0; n < 300; n += 1)
			writeSession(env.sessionDir, chat(`bulk-${String(n).padStart(3, "0")}`, env.cwd, 1_000 + n));
		const started = performance.now();
		const first = await ids({ limit: 50 }, { cwd: env.cwd });
		const coldMs = performance.now() - started;
		const warmStarted = performance.now();
		const second = await ids({ limit: 50 }, { cwd: env.cwd });
		const warmMs = performance.now() - warmStarted;

		expect(first.ids).toHaveLength(50);
		expect(second.ids).toEqual(first.ids);
		expect(coldMs).toBeLessThan(3_000);
		expect(warmMs).toBeLessThan(coldMs + 50);
	});
});
