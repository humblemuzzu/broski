/**
 * Codex thread CRUD handler.
 * Extracted from server.ts — cases: cx_list_projects, cx_list_threads,
 * cx_warmup, cx_start_thread, cx_resume_thread, cx_archive_thread,
 * cx_thread_fork, cx_thread_rollback
 */

import type { CodexAppServerClient } from "../../connectors/codex";
import {
	listProjectsFromDb as cxListProjectsFromDb,
	listThreadsFromDb as cxListThreadsFromDb,
	findCodexStateDbPath,
} from "../../connectors/codex/cx-sqlite";
import type { CxMessage } from "../../routing/messages";
import type { CodexThread } from "../../types";
import { resolveCxProjects } from "./cx_projects";
import { handleCxThreadList } from "./cx_thread_list";
import { CX_WARMUP_PAGE_LIMIT, warmCxCaches } from "./cx_warmup";

// Cache entry types (mirrored from server.ts scope)
type CxThreadCacheEntry = {
	data: any[];
	fetchedAt: number;
	nextCursor: string | null;
};
type CxProjectCacheEntry = { data: any[]; fetchedAt: number };

export type CxThreadsHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	codexClient: CodexAppServerClient | null;
	codexFs: {
		listProjectsFromFs: () => Promise<any[]>;
		listThreadsFromFs: (cwd?: string) => Promise<any[]>;
		enrichThreadsWithStats: (threads: any[]) => Promise<void>;
	};
	safeString: (v: unknown) => string;
	getSecurePath: (path: string) => Promise<string | null>;
	logInfo: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
	// Caches
	cxProjectCache: CxProjectCacheEntry | null;
	setProjectCache: (cache: CxProjectCacheEntry | null) => void;
	cxThreadCache: Map<string, CxThreadCacheEntry>;
	CODEX_PROJECT_CACHE_TTL_MS: number;
	CODEX_THREAD_CACHE_TTL_MS: number;
	// Thread tracking maps
	cxThreadNames: Map<string, string>;
	cxThreadOwners: Map<string, any>;
	cxThreadCwds: Map<string, string>;
	// Helpers
	mapCodexThread: (thread: any, nameOverride?: string) => CodexThread & { threadName?: string };
	mapCodexThreadToRuntimeSession: (thread: any) => any;
	invalidateCodexCaches: (cwd?: string) => void;
	ws: any; // current socket for ownership
};

export async function handleCxThreads(
	message: CxMessage,
	reply: (msg: any) => void,
	ctx: CxThreadsHandlerContext,
): Promise<boolean> {
	switch (message.type) {
		// ── cx_list_projects ─────────────────────────────────────────────
		case "cx_list_projects": {
			const now = Date.now();
			const forceRefresh = message.refresh === true;

			// Check cache first (unless explicit refresh requested)
			if (!forceRefresh && ctx.cxProjectCache && now - ctx.cxProjectCache.fetchedAt < ctx.CODEX_PROJECT_CACHE_TTL_MS) {
				ctx.logInfo("[cx_list_projects] Cache hit, returning cached data");
				reply({ type: "cx_projects", data: ctx.cxProjectCache.data, requestId: message.requestId });
				return true;
			}

			const { projects, source } = await resolveCxProjects({
				listProjectsFromFs: () => ctx.codexFs.listProjectsFromFs(),
				ensureCodexClient: ctx.ensureCodexClient,
				safeString: ctx.safeString,
				logInfo: ctx.logInfo,
			});

			ctx.setProjectCache({ data: projects, fetchedAt: Date.now() });
			ctx.logInfo(`[cx_list_projects] Done, cached ${projects.length} projects (${source})`);
			reply({ type: "cx_projects", data: projects, requestId: message.requestId });
			return true;
		}

		// ── cx_list_threads ──────────────────────────────────────────────
		case "cx_list_threads": {
			await handleCxThreadList(message, reply, ctx);
			return true;
		}

		// ── cx_warmup ──
		case "cx_warmup": {
			// Pre-populate the caches the phone reads first: the SQLite-backed project and thread
			// lists, then the diff stats of that first page. No whole-tree filesystem scan.
			ctx.logInfo("[cx_warmup] Starting Codex warmup (SQLite index)...");
			reply({ type: "cx_warmup_started", requestId: message.requestId });

			const pageLimit = typeof message.limit === "number" && message.limit > 0 ? message.limit : CX_WARMUP_PAGE_LIMIT;
			warmCxCaches(
				{
					findDbPath: findCodexStateDbPath,
					listProjectsFromDb: (dbPath) => cxListProjectsFromDb(dbPath),
					listThreadsFromDb: (dbPath) => cxListThreadsFromDb({ limit: pageLimit, sortKey: "updated_at" }, dbPath),
					listProjectsFromFs: () => ctx.codexFs.listProjectsFromFs(),
					listThreadsFromFs: (cwd) => ctx.codexFs.listThreadsFromFs(cwd),
					enrichThreadsWithStats: (threads) => ctx.codexFs.enrichThreadsWithStats(threads),
					setProjectCache: (projects) => ctx.setProjectCache({ data: projects, fetchedAt: Date.now() }),
					setThreadCache: (key, threads) =>
						ctx.cxThreadCache.set(key, { data: threads, fetchedAt: Date.now(), nextCursor: null }),
					logInfo: ctx.logInfo,
					logError: ctx.logError,
				},
				pageLimit,
			).catch((e: any) => ctx.logError("[cx_warmup] Error:", e?.message ?? e));
			return true;
		}

		// ── cx_start_thread ──────────────────────────────────────────────
		case "cx_start_thread": {
			const client = await ctx.ensureCodexClient();
			const cwd = ctx.safeString(message.cwd).trim();
			if (!cwd) {
				reply({ type: "error", message: "Missing cwd", requestId: message.requestId });
				return true;
			}
			const personalityVal = ctx.safeString(message.personality).trim().toLowerCase();
			const personality =
				personalityVal === "none" || personalityVal === "friendly" || personalityVal === "pragmatic"
					? personalityVal
					: null;
			const result: any = await client.request("thread/start", {
				cwd,
				model: message.model ?? null,
				approvalPolicy: message.approvalPolicy ?? null,
				sandbox: message.sandbox ?? null,
				...(personality ? { personality } : {}),
				experimentalRawEvents: false,
			});
			const threadId_start = ctx.safeString(result?.thread?.id);
			const thread = ctx.mapCodexThread(result?.thread, ctx.cxThreadNames.get(threadId_start));
			if (thread.id && thread.cwd) {
				const secureThreadCwd = await ctx.getSecurePath(thread.cwd);
				if (secureThreadCwd) ctx.cxThreadCwds.set(thread.id, secureThreadCwd);
			}
			// Invalidate caches since a new thread was created
			ctx.invalidateCodexCaches(thread.cwd);
			reply({ type: "cx_thread_created", data: thread, requestId: message.requestId });
			return true;
		}

		// ── cx_resume_thread ─────────────────────────────────────────────
		case "cx_resume_thread": {
			const client = await ctx.ensureCodexClient();
			const personalityResume = ctx.safeString(message.personality).trim().toLowerCase();
			const personalityResumeVal =
				personalityResume === "none" || personalityResume === "friendly" || personalityResume === "pragmatic"
					? personalityResume
					: null;
			const result: any = await client.request("thread/resume", {
				threadId: message.threadId,
				...(personalityResumeVal ? { personality: personalityResumeVal } : {}),
			});
			const thread = ctx.mapCodexThread(result?.thread, ctx.cxThreadNames.get(message.threadId));
			if (thread.id && thread.cwd) {
				const secureThreadCwd = await ctx.getSecurePath(thread.cwd);
				if (secureThreadCwd) ctx.cxThreadCwds.set(thread.id, secureThreadCwd);
			}
			reply({ type: "cx_thread", data: thread, requestId: message.requestId });
			return true;
		}

		// ── cx_archive_thread ────────────────────────────────────────────
		case "cx_archive_thread": {
			const client = await ctx.ensureCodexClient();
			// Get the thread's cwd before archiving (for cache invalidation)
			const archivedCwd = ctx.cxThreadCwds.get(message.threadId);
			await client.request("thread/archive", { threadId: message.threadId });
			// Invalidate caches since a thread was archived
			ctx.invalidateCodexCaches(archivedCwd);
			reply({
				type: "cx_thread_archived",
				data: true,
				threadId: message.threadId,
				requestId: message.requestId,
			});
			return true;
		}

		// ── cx_thread_fork ───────────────────────────────────────────────
		case "cx_thread_fork": {
			const client = await ctx.ensureCodexClient();
			const result: any = await client.request("thread/fork", {
				threadId: message.threadId,
			});
			const thread = result?.thread;
			if (thread) {
				const id = ctx.safeString(thread?.id);
				if (id) {
					ctx.cxThreadOwners.set(id, ctx.ws);
					const cwd = ctx.safeString(thread?.cwd);
					if (cwd) {
						const secureThreadCwd = await ctx.getSecurePath(cwd);
						if (secureThreadCwd) ctx.cxThreadCwds.set(id, secureThreadCwd);
					}
				}
				const forkedId = ctx.safeString(thread?.id);
				reply({
					type: "cx_thread_forked",
					data: ctx.mapCodexThread(thread, ctx.cxThreadNames.get(forkedId)),
					requestId: message.requestId,
				});
			} else {
				reply({ type: "error", message: "Fork failed", requestId: message.requestId });
			}
			return true;
		}

		// ── cx_thread_rollback ───────────────────────────────────────────
		case "cx_thread_rollback": {
			const client = await ctx.ensureCodexClient();
			const result: any = await client.request("thread/rollback", {
				threadId: message.threadId,
				numTurns: message.numTurns,
			});
			const thread = result?.thread;
			if (thread) {
				reply({
					type: "cx_thread_rolled_back",
					data: ctx.mapCodexThread(thread, ctx.cxThreadNames.get(message.threadId)),
					requestId: message.requestId,
				});
			} else {
				reply({ type: "error", message: "Rollback failed", requestId: message.requestId });
			}
			return true;
		}

		// ── cx_thread_unsubscribe ────────────────────────────────────────
		case "cx_thread_unsubscribe": {
			const threadId = ctx.safeString(message.threadId).trim();
			if (!threadId) {
				reply({ type: "cx_error", error: "Missing threadId", requestId: message.requestId });
				return true;
			}
			try {
				const client = await ctx.ensureCodexClient();
				await client.request("thread/unsubscribe", { threadId });
				// Clean up tracking maps
				ctx.cxThreadOwners.delete(threadId);
				ctx.cxThreadCwds.delete(threadId);
				reply({
					type: "cx_thread_unsubscribed",
					data: { threadId },
					requestId: message.requestId,
				});
			} catch (e: any) {
				ctx.logError("thread/unsubscribe failed", e);
				// Reply success anyway — the thread is gone from our perspective
				reply({
					type: "cx_thread_unsubscribed",
					data: { threadId },
					requestId: message.requestId,
				});
			}
			return true;
		}

		default:
			return false;
	}
}
