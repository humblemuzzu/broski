/**
 * Session list paging across every list path: the same `limit`/`before` in, `hasMore`/`nextCursor`
 * out contract the transcript readers use, over a walk that never duplicates or skips a row.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions as listPiSessions } from "../connectors/pi";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import { handle as handleCcSessions } from "../handlers/cc_sessions";
import { type CxThreadListContext, handleCxThreadList } from "../handlers/codex/cx_thread_list";
import { handle as handleOcSessions } from "../handlers/oc_sessions";
import { sessionListReply } from "../handlers/session_list_reply";
import { unifiedListSessions } from "../handlers/unified_session_lists";
import type { ClaudeCodeSession, CodexThread, ServerMessage, SessionSummary } from "../types";
import { DEFAULT_SESSION_PAGE_LIMIT, pageSessionList } from "../utils/session-list-page";
import { SESSION_PREVIEW_ELLIPSIS, SESSION_PREVIEW_MAX_CHARS } from "../utils/session-preview";

const PI_CWD = "/tmp/broski-paging-pi-project";
const PI_SESSION_COUNT = 3000;
const HUGE_MESSAGE_CHARS = 100_000;
const HUGE_MESSAGES = 3;
const PAGE_LIMIT = DEFAULT_SESSION_PAGE_LIMIT;
const LINK_LIMIT_BYTES = 8 * 1024 * 1024;
const SMALL_PROJECT_SESSIONS = 250;

let root = "";
let cacheRoot = "";
let piSessionDir = "";

type Page<T> = { items: T[]; hasMore: boolean; nextCursor?: string };
type Row = { id: string; modified: number };

const piFile = (index: number): string => `s${String(index).padStart(5, "0")}`;

const unused = (): never => {
	throw new Error("not used by this test");
};

async function writePiSession(index: number): Promise<void> {
	const id = piFile(index);
	const timestampMs = 1_700_000_000_000 + index * 1000;
	const text = index < HUGE_MESSAGES ? "u".repeat(HUGE_MESSAGE_CHARS) : `message ${index}`;
	const header = { type: "session", version: 3, id, timestamp: new Date(timestampMs).toISOString(), cwd: PI_CWD };
	const entry = {
		type: "message",
		id: `e${index}`,
		parentId: null,
		timestamp: new Date(timestampMs + 500).toISOString(),
		message: { role: "user", content: text, timestamp: timestampMs + 500 },
	};
	await writeFile(join(piSessionDir, `${id}.jsonl`), `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
}

const piRow = (session: { id: string; modified: number }): Row => ({ id: session.id, modified: session.modified });

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "broski-paging-pi-"));
	cacheRoot = await mkdtemp(join(tmpdir(), "broski-paging-cache-"));
	piSessionDir = defaultSessionDirForCwd(PI_CWD, root);
	await mkdir(piSessionDir, { recursive: true });
	await Promise.all(Array.from({ length: PI_SESSION_COUNT }, (_, index) => writePiSession(index)));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(cacheRoot, { recursive: true, force: true });
});

async function walk<T extends { id: string }>(
	fetchPage: (before?: string) => Promise<Page<T>>,
	orderOf: (item: T) => number,
): Promise<T[]> {
	const seen: T[] = [];
	let before: string | undefined;
	for (let guard = 0; guard <= PI_SESSION_COUNT; guard++) {
		const page = await fetchPage(before);
		expect(page.items.length).toBeLessThanOrEqual(PAGE_LIMIT);
		expect(page.items.length).toBeGreaterThan(0);
		seen.push(...page.items);
		if (!page.hasMore) return seen;
		expect(page.nextCursor).toBeTruthy();
		before = page.nextCursor;
	}
	throw new Error("page walk did not terminate");
}

function expectUniqueNewestFirst<T extends { id: string }>(items: T[], orderOf: (item: T) => number): void {
	const ids = items.map((item) => item.id);
	expect(new Set(ids).size).toBe(ids.length);
	for (let i = 1; i < items.length; i++) {
		expect(orderOf(items[i - 1] as T)).toBeGreaterThanOrEqual(orderOf(items[i] as T));
	}
}

describe("Pi session list paging", () => {
	test("a first page is one page, and every preview is capped", async () => {
		const sessions = await listPiSessions(undefined, { root, cacheRoot });
		expect(sessions).toHaveLength(PI_SESSION_COUNT);
		for (const session of sessions) expect(session.firstMessage.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_CHARS);

		const huge = sessions.find((session) => session.id === piFile(0));
		expect(huge?.firstMessage.endsWith(SESSION_PREVIEW_ELLIPSIS)).toBeTrue();

		const reply = sessionListReply(sessions, { limit: PAGE_LIMIT }, piRow);
		expect(reply.data).toHaveLength(PAGE_LIMIT);
		expect(reply.hasMore).toBeTrue();
		expect(reply.nextCursor).toBeTruthy();
	});

	test("a page walk returns every session exactly once, newest first", async () => {
		const sessions = await listPiSessions(undefined, { root, cacheRoot });
		const walked = await walk(
			async (before) => pageSessionList(sessions, { limit: PAGE_LIMIT, ...(before ? { before } : {}) }, piRow),
			(session) => session.modified,
		);
		expect(walked).toHaveLength(PI_SESSION_COUNT);
		expect(walked.map((session) => session.id).sort()).toEqual(sessions.map((session) => session.id).sort());
		expectUniqueNewestFirst(walked, (session) => session.modified);
	});

	test("a session created between two pages neither duplicates nor skips a row", async () => {
		const before = await listPiSessions(undefined, { root, cacheRoot });
		const first = pageSessionList(before, { limit: PAGE_LIMIT }, piRow);
		const firstIds = new Set(first.items.map((session) => session.id));

		await writePiSession(PI_SESSION_COUNT);
		const after = await listPiSessions(undefined, { root, cacheRoot });
		expect(after).toHaveLength(PI_SESSION_COUNT + 1);

		const rest: string[] = [];
		let cursor = first.nextCursor;
		while (cursor) {
			const page = pageSessionList(after, { limit: PAGE_LIMIT, before: cursor }, piRow);
			rest.push(...page.items.map((session) => session.id));
			cursor = page.hasMore ? page.nextCursor : undefined;
		}
		for (const id of rest) expect(firstIds.has(id)).toBeFalse();
		expect(new Set([...firstIds, ...rest])).toEqual(new Set(before.map((session) => session.id)));
	});

	test("the whole list fits one link frame once previews are capped", async () => {
		const sessions = await listPiSessions(undefined, { root, cacheRoot });
		const bytes = new TextEncoder().encode(JSON.stringify({ type: "pi_sessions", data: sessions })).length;
		expect(bytes).toBeLessThan(LINK_LIMIT_BYTES / 4);
	});
});

describe("Claude Code session list paging", () => {
	const sessions: ClaudeCodeSession[] = Array.from({ length: SMALL_PROJECT_SESSIONS }, (_, index) => ({
		id: `c${String(index).padStart(4, "0")}`,
		title: `Claude session ${index}`,
		cwd: "/tmp/cc-project",
		createdAt: 1_700_000_000_000 + index * 1000,
		updatedAt: 1_700_000_000_000 + index * 1000,
	}));

	const repliesFor = async (message: { limit?: number; before?: string }): Promise<ServerMessage[]> => {
		const replies: ServerMessage[] = [];
		await handleCcSessions({ type: "cc_list_sessions", ...message }, (reply) => replies.push(reply), {
			claudeCode: {
				listProjects: unused,
				listSessions: async () => sessions,
				getSession: unused,
				getSessionMessages: unused,
				deleteSession: unused,
				forkSession: unused,
				renameSession: unused,
				listActiveSessions: () => [],
				resolveSessionFilePath: unused,
				getModifiedFiles: unused,
			},
		});
		return replies;
	};

	test("pages newest first and answers the list once", async () => {
		const replies = await repliesFor({ limit: PAGE_LIMIT });
		expect(replies.map((reply) => reply.type)).toEqual(["cc_sessions"]);
		expect((replies[0] as Extract<ServerMessage, { type: "cc_sessions" }>).data).toHaveLength(PAGE_LIMIT);

		const walked = await walk(
			async (before) => {
				const [reply] = await repliesFor({ limit: PAGE_LIMIT, ...(before ? { before } : {}) });
				const page = reply as Extract<ServerMessage, { type: "cc_sessions" }>;
				return { items: page.data, hasMore: page.hasMore ?? false, nextCursor: page.nextCursor };
			},
			(session) => session.updatedAt,
		);
		expect(walked).toHaveLength(SMALL_PROJECT_SESSIONS);
		expectUniqueNewestFirst(walked, (session) => session.updatedAt);
	});
});

const codexContext = (threads: CodexThread[]): CxThreadListContext => ({
	codexClient: null,
	ensureCodexClient: unused,
	codexFs: { listThreadsFromFs: async () => threads, enrichThreadsWithStats: async () => undefined },
	logInfo: () => {},
	logError: () => {},
	cxThreadCache: new Map(),
	CODEX_THREAD_CACHE_TTL_MS: 0,
	cxThreadNames: new Map<string, string>(),
	listFromDb: () => threads,
	dbPath: "/fake/state.sqlite",
});

describe("Codex thread list paging", () => {
	const threads: CodexThread[] = Array.from({ length: SMALL_PROJECT_SESSIONS }, (_, index) => ({
		id: `x${String(index).padStart(4, "0")}`,
		preview: `Thread ${index}`,
		createdAt: 1_700_000_000 + index,
		updatedAt: 1_700_000_000 + index,
		cwd: "/tmp/cx-project",
	}));
	const context = codexContext(threads);

	const repliesFor = async (message: {
		limit?: number;
		before?: string;
		refresh?: boolean;
	}): Promise<ServerMessage[]> => {
		const replies: ServerMessage[] = [];
		await handleCxThreadList(
			{ type: "cx_list_threads", ...message },
			(reply) => replies.push(reply as ServerMessage),
			context,
		);
		return replies;
	};

	test("pages newest first and never sends a runtime list", async () => {
		const replies = await repliesFor({ refresh: true });
		expect(replies.map((reply) => reply.type)).toEqual(["cx_threads"]);

		const walked = await walk(
			async (before) => {
				const [reply] = await repliesFor({ limit: PAGE_LIMIT, ...(before ? { before } : {}) });
				const page = reply as Extract<ServerMessage, { type: "cx_threads" }>;
				return { items: page.data, hasMore: page.hasMore ?? false, nextCursor: page.nextCursor ?? undefined };
			},
			(thread) => thread.updatedAt,
		);
		expect(walked).toHaveLength(SMALL_PROJECT_SESSIONS);
		expectUniqueNewestFirst(walked, (thread) => thread.updatedAt);
	});
});

describe("OpenCode session list paging", () => {
	const sessions: SessionSummary[] = Array.from({ length: SMALL_PROJECT_SESSIONS }, (_, index) => ({
		id: `o${String(index).padStart(4, "0")}`,
		title: `OC session ${index}`,
		projectID: "p1",
		directory: "/tmp/oc-project",
		time: { created: 1_700_000_000_000 + index * 1000, updated: 1_700_000_000_000 + index * 1000 },
	}));

	test("pages newest first with no repeats", async () => {
		const walked = await walk(
			async (before) => {
				let reply: ServerMessage | undefined;
				const handled = await handleOcSessions(
					{ type: "list_sessions", limit: PAGE_LIMIT, ...(before ? { before } : {}) },
					(message) => {
						reply = message;
					},
					() => ({ listSessions: async () => sessions }),
				);
				expect(handled).toBeTrue();
				const page = reply as Extract<ServerMessage, { type: "sessions" }>;
				return { items: page.data, hasMore: page.hasMore ?? false, nextCursor: page.nextCursor };
			},
			(session) => session.time.updated,
		);
		expect(walked).toHaveLength(SMALL_PROJECT_SESSIONS);
		expectUniqueNewestFirst(walked, (session) => session.time.updated);
	});
});

describe("unified_list_sessions paging", () => {
	const ccSessions: ClaudeCodeSession[] = Array.from({ length: SMALL_PROJECT_SESSIONS }, (_, index) => ({
		id: `u${String(index).padStart(4, "0")}`,
		title: `Unified ${index}`,
		cwd: "/tmp/unified",
		createdAt: 1_700_000_000_000 + index * 1000,
		updatedAt: 1_700_000_000_000 + index * 1000,
	}));

	test("pages the named backend", async () => {
		const walked = await walk(
			async (before) => {
				let reply: { data: ClaudeCodeSession[]; hasMore?: boolean; nextCursor?: string } | undefined;
				await unifiedListSessions(
					{
						type: "unified_list_sessions",
						backend: "claude-code",
						limit: PAGE_LIMIT,
						...(before ? { before } : {}),
					},
					(message) => {
						reply = message as typeof reply;
					},
					{
						claudeCode: { listSessions: async () => ccSessions },
						requireOpenCode: () => null,
						codex: codexContext([]),
					},
				);
				return { items: reply?.data ?? [], hasMore: reply?.hasMore ?? false, nextCursor: reply?.nextCursor };
			},
			(session) => session.updatedAt,
		);
		expect(walked).toHaveLength(SMALL_PROJECT_SESSIONS);
		expectUniqueNewestFirst(walked, (session) => session.updatedAt);
	});
});
