/**
 * Codex thread listing (`cx_list_threads`).
 *
 * A request that names `limit`/`before` is answered from the local index (SQLite first, then the
 * rollout files) and cut up by the shared session-list contract, because an RPC page and a page
 * cursor name different boundaries. A request that names neither keeps the RPC-first listing it
 * always got.
 */

import { resolve } from "node:path";
import { type CxSqliteListOptions, findCodexStateDbPath, listThreadsFromDb } from "../../connectors/codex/cx-sqlite";
import { DEFAULT_CX_ENRICH_LIMIT } from "../../connectors/codex-fs";
import type { CxMessage } from "../../routing/messages";
import type { CodexThread } from "../../types";
import { isPagedSessionRequest, sessionPageRequest } from "../../utils/session-list-page";
import { sessionListReply } from "../session_list_reply";

export type CxThreadCacheEntry = { data: CodexThread[]; fetchedAt: number; nextCursor: string | null };

export type CxThreadListContext = {
	codexClient: { isRunning: boolean; request: (method: string, params: unknown) => Promise<unknown> } | null;
	ensureCodexClient: () => Promise<{ request: (method: string, params: unknown) => Promise<unknown> }>;
	codexFs: {
		listThreadsFromFs: (cwd?: string) => Promise<CodexThread[]>;
		enrichThreadsWithStats: (threads: CodexThread[]) => Promise<void>;
	};
	logInfo: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
	cxThreadCache: Map<string, CxThreadCacheEntry>;
	CODEX_THREAD_CACHE_TTL_MS: number;
	cxThreadNames: Map<string, string>;
	/** Injected by tests; the running bridge reads Codex's own index. */
	listFromDb?: (options: CxSqliteListOptions, dbPath: string) => CodexThread[];
	dbPath?: string | null;
};

type CxThreadMessage = CxMessage & { type: "cx_list_threads" };

type Reply = (message: unknown) => void;

type ListedThreads = { threads: CodexThread[]; nextCursor: string | null };

/** The filters a listing can be narrowed by; a message carries them, a caller may pass only `cwd`. */
export type CxListFilters = {
	cwd?: string;
	archived?: boolean;
	searchTerm?: string;
	sortKey?: string | null;
	sourceKinds?: string[];
	modelProviders?: string[];
};

const sqliteOptions = (filters: CxListFilters): CxSqliteListOptions => ({
	cwd: filters.cwd,
	archived: filters.archived,
	searchTerm: filters.searchTerm,
	sortKey: filters.sortKey === "created_at" ? "created_at" : "updated_at",
	sourceKinds: filters.sourceKinds,
	modelProviders: filters.modelProviders,
});

const resolveDbPath = (ctx: CxThreadListContext): string | null =>
	ctx.dbPath === undefined ? findCodexStateDbPath() : ctx.dbPath;

const readDb = (ctx: CxThreadListContext, options: CxSqliteListOptions, dbPath: string): CodexThread[] =>
	(ctx.listFromDb ?? listThreadsFromDb)(options, dbPath);

function rpcParams(message: CxThreadMessage): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	if (message.cursor) params.cursor = message.cursor;
	if (message.limit) params.limit = message.limit;
	if (message.sortKey) params.sortKey = message.sortKey;
	if (message.modelProviders) params.modelProviders = message.modelProviders;
	if (message.sourceKinds) params.sourceKinds = message.sourceKinds;
	if (message.archived !== undefined && message.archived !== null) params.archived = message.archived;
	if (message.cwd) params.cwd = message.cwd;
	if (message.searchTerm) params.searchTerm = message.searchTerm;
	return params;
}

async function askThreadList(
	client: { request: (method: string, params: unknown) => Promise<unknown> },
	params: Record<string, unknown>,
): Promise<ListedThreads> {
	const result = (await client.request("thread/list", params)) as {
		data?: CodexThread[];
		nextCursor?: string | null;
	} | null;
	return { threads: result?.data ?? [], nextCursor: result?.nextCursor ?? null };
}

/** SQLite is authoritative when it exists: an empty result there is a real no-match, not a miss. */
async function listFromIndex(message: CxThreadMessage, ctx: CxThreadListContext): Promise<ListedThreads> {
	const dbPath = resolveDbPath(ctx);
	if (dbPath) return { threads: readDb(ctx, sqliteOptions(message), dbPath), nextCursor: null };

	const threads = await ctx.codexFs.listThreadsFromFs(message.cwd ?? undefined);
	if (threads.length > 0) return { threads, nextCursor: null };

	try {
		return await askThreadList(await ctx.ensureCodexClient(), {});
	} catch (error) {
		ctx.logError("[cx_list_threads] Cold thread/list fallback unavailable:", error);
		return { threads: [], nextCursor: null };
	}
}

async function listThreads(message: CxThreadMessage, ctx: CxThreadListContext): Promise<ListedThreads> {
	const client = ctx.codexClient;
	if (client?.isRunning) {
		try {
			return await askThreadList(client, rpcParams(message));
		} catch (error) {
			ctx.logError("[cx_list_threads] RPC failed, falling back to the local index:", error);
		}
	}
	return listFromIndex(message, ctx);
}

/** Every thread the local index knows for these filters, so a caller can cut a page from the whole list. */
export async function localThreads(filters: CxListFilters, ctx: CxThreadListContext): Promise<CodexThread[]> {
	const dbPath = resolveDbPath(ctx);
	if (dbPath) {
		const threads = readDb(ctx, { ...sqliteOptions(filters), limit: 0 }, dbPath);
		if (threads.length > 0) return threads;
	}
	return ctx.codexFs.listThreadsFromFs(filters.cwd);
}

function withThreadNames(threads: CodexThread[], ctx: CxThreadListContext): CodexThread[] {
	if (ctx.cxThreadNames.size === 0) return threads;
	return threads.map((thread) => {
		const name = ctx.cxThreadNames.get(thread.id);
		return name ? { ...thread, threadName: name } : thread;
	});
}

/** Only the threads the phone asked for are enriched, never the whole rollout tree. */
function enrichInBackground(threads: CodexThread[], limit: unknown, ctx: CxThreadListContext): void {
	const enrichLimit = typeof limit === "number" && limit > 0 ? limit : DEFAULT_CX_ENRICH_LIMIT;
	ctx.codexFs.enrichThreadsWithStats(threads.slice(0, enrichLimit)).catch((error: unknown) => {
		ctx.logError("[cx_list_threads] Stats enrichment failed (non-fatal):", error);
	});
}

function replyPage(message: CxThreadMessage, reply: Reply, threads: CodexThread[], ctx: CxThreadListContext): void {
	const named = withThreadNames(threads, ctx);
	enrichInBackground(named, message.limit, ctx);
	reply({
		type: "cx_threads",
		...sessionListReply(named, message, (thread: CodexThread) => ({ id: thread.id, modified: thread.updatedAt })),
		requestId: message.requestId,
	});
}

function replyCached(
	message: CxThreadMessage,
	reply: Reply,
	cached: CxThreadCacheEntry,
	ctx: CxThreadListContext,
): void {
	reply({
		type: "cx_threads",
		data: withThreadNames(cached.data, ctx),
		nextCursor: cached.nextCursor,
		requestId: message.requestId,
	});
}

export async function handleCxThreadList(
	message: CxThreadMessage,
	reply: Reply,
	ctx: CxThreadListContext,
): Promise<void> {
	if (isPagedSessionRequest(sessionPageRequest(message))) {
		replyPage(message, reply, await localThreads(message, ctx), ctx);
		return;
	}

	const cacheKey = message.cwd ? resolve(message.cwd) : "__all__";
	const cached = ctx.cxThreadCache.get(cacheKey);
	if (
		message.refresh !== true &&
		!message.cursor &&
		cached &&
		Date.now() - cached.fetchedAt < ctx.CODEX_THREAD_CACHE_TTL_MS
	) {
		replyCached(message, reply, cached, ctx);
		return;
	}

	const listed = await listThreads(message, ctx);
	const named = withThreadNames(listed.threads, ctx);
	enrichInBackground(named, message.limit, ctx);
	ctx.cxThreadCache.set(cacheKey, { data: named, fetchedAt: Date.now(), nextCursor: listed.nextCursor });
	reply({ type: "cx_threads", data: named, nextCursor: listed.nextCursor, requestId: message.requestId });
}
