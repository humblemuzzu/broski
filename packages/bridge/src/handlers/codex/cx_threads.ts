/**
 * Codex thread CRUD handler.
 * Extracted from server.ts — cases: cx_list_projects, cx_list_threads,
 * cx_warmup, cx_start_thread, cx_resume_thread, cx_archive_thread,
 * cx_thread_fork, cx_thread_rollback
 */

import { basename, resolve } from "node:path";
import type { CodexAppServerClient } from "../../connectors/codex";
import {
	listProjectsFromDb as cxListProjectsFromDb,
	listThreadsFromDb as cxListThreadsFromDb,
	findCodexStateDbPath,
} from "../../connectors/codex/cx-sqlite";
import type { CodexThread } from "../../types";

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
	message: any,
	reply: (msg: any) => void,
	ctx: CxThreadsHandlerContext,
): Promise<boolean> {
	switch (message.type) {
		// ── cx_list_projects ─────────────────────────────────────────────
		case "cx_list_projects": {
			// FAST PATH: Read directly from filesystem (no app-server needed!)
			// Same pattern as Claude Code - instant file I/O instead of subprocess
			const now = Date.now();
			const forceRefresh = message.refresh === true;

			// Check cache first (unless explicit refresh requested)
			if (!forceRefresh && ctx.cxProjectCache && now - ctx.cxProjectCache.fetchedAt < ctx.CODEX_PROJECT_CACHE_TTL_MS) {
				ctx.logInfo("[cx_list_projects] Cache hit, returning cached data");
				reply({ type: "cx_projects", data: ctx.cxProjectCache.data, requestId: message.requestId });
				return true;
			}

			ctx.logInfo(
				`[cx_list_projects] ${forceRefresh ? "Refresh requested" : "Cache miss"}, reading from filesystem...`,
			);
			let projects = await ctx.codexFs.listProjectsFromFs();

			// Tier 2: SQLite fallback — much faster than cold-starting app-server.
			if (projects.length === 0) {
				const dbPath = findCodexStateDbPath();
				if (dbPath) {
					projects = cxListProjectsFromDb(dbPath);
					if (projects.length > 0) {
						ctx.logInfo(`[cx_list_projects] Filesystem empty, recovered ${projects.length} projects via SQLite`);
					}
				}
			}

			// Tier 3: Cold-start app-server — last resort.
			if (projects.length === 0) {
				try {
					const client = await ctx.ensureCodexClient();
					const rpcResult: any = await client.request("thread/list", {
						limit: 200,
					});
					const threads: any[] = rpcResult?.data ?? [];
					const byPath = new Map<string, { id: string; name: string; path: string }>();
					for (const thread of threads) {
						const path = ctx.safeString(thread?.cwd).trim();
						if (!path) continue;
						const name = basename(path);
						byPath.set(path, { id: path, name: name || path, path });
					}
					projects = Array.from(byPath.values());
					ctx.logInfo(`[cx_list_projects] Recovered ${projects.length} projects via cold thread/list`);
				} catch (err: any) {
					ctx.logInfo(`[cx_list_projects] Cold thread/list fallback unavailable: ${err?.message ?? err}`);
				}
			}

			// Update cache
			ctx.setProjectCache({ data: projects, fetchedAt: Date.now() });
			ctx.logInfo(`[cx_list_projects] Done, cached ${projects.length} projects`);
			reply({ type: "cx_projects", data: projects, requestId: message.requestId });
			return true;
		}

		// ── cx_list_threads ──────────────────────────────────────────────
		case "cx_list_threads": {
			// Protocol: thread/list via JSON-RPC (preferred) with filesystem fallback
			// ThreadListParams: { cursor?, limit?, sortKey?, modelProviders?, sourceKinds?, archived?, cwd? }
			// ThreadListResponse: { data: Thread[], nextCursor: string | null }
			const now = Date.now();
			const forceRefresh = message.refresh === true;
			const cacheKey = message.cwd ? resolve(message.cwd) : "__all__";

			// Check cache first (unless explicit refresh or cursor-based pagination)
			const cached = ctx.cxThreadCache.get(cacheKey);
			if (!forceRefresh && !message.cursor && cached && now - cached.fetchedAt < ctx.CODEX_THREAD_CACHE_TTL_MS) {
				ctx.logInfo(`[cx_list_threads] Cache hit for ${cacheKey}, returning cached data`);
				// Merge latest thread names into cached response (names may have changed since caching)
				const cachedData =
					ctx.cxThreadNames.size > 0
						? cached.data.map((t: any) => {
								const name = ctx.cxThreadNames.get(t.id);
								return name ? { ...t, threadName: name } : t;
							})
						: cached.data;
				reply({
					type: "cx_threads",
					data: cachedData,
					nextCursor: cached.nextCursor,
					requestId: message.requestId,
				});
				return true;
			}

			ctx.logInfo(`[cx_list_threads] ${forceRefresh ? "Refresh requested" : "Cache miss"}, fetching thread list...`);

			// Try JSON-RPC thread/list first (if Codex is running), fall back to filesystem
			let threadData: any[] = [];
			let nextCursor: string | null = null;
			try {
				if (ctx.codexClient?.isRunning) {
					// Use proper thread/list RPC — supports filtering, sorting, pagination
					const rpcParams: any = {};
					if (message.cursor) rpcParams.cursor = message.cursor;
					if (message.limit) rpcParams.limit = message.limit;
					if (message.sortKey) rpcParams.sortKey = message.sortKey;
					if (message.modelProviders) rpcParams.modelProviders = message.modelProviders;
					if (message.sourceKinds) rpcParams.sourceKinds = message.sourceKinds;
					if (message.archived !== undefined && message.archived !== null) rpcParams.archived = message.archived;
					if (message.cwd) rpcParams.cwd = message.cwd;
					if (message.searchTerm) rpcParams.searchTerm = message.searchTerm;

					const result: any = await ctx.codexClient.request("thread/list", rpcParams);
					threadData = result?.data ?? [];
					nextCursor = result?.nextCursor ?? null;
					ctx.logInfo(`[cx_list_threads] Got ${threadData.length} threads via thread/list RPC`);
				} else {
					// Codex not running — try SQLite first (fast indexed queries), then filesystem.
					const dbPath = findCodexStateDbPath();

					if (dbPath) {
						// Tier 2: SQLite available — use as authoritative offline source.
						// Empty result = genuine no-match; do NOT fall through to unfiltered filesystem.
						threadData = cxListThreadsFromDb(
							{
								cwd: message.cwd ?? undefined,
								limit: message.limit ?? undefined,
								archived: message.archived,
								searchTerm: message.searchTerm ?? undefined,
								sortKey: message.sortKey === "created_at" ? "created_at" : "updated_at",
								sourceKinds: message.sourceKinds ?? undefined,
								modelProviders: message.modelProviders ?? undefined,
							},
							dbPath,
						);
						nextCursor = null;
						ctx.logInfo(`[cx_list_threads] Got ${threadData.length} threads via SQLite fallback`);
					} else {
						// Tier 3: No SQLite — filesystem is the only offline option (no filter support).
						threadData = await ctx.codexFs.listThreadsFromFs(message.cwd ?? undefined);
						nextCursor = null;
						ctx.logInfo(`[cx_list_threads] Got ${threadData.length} threads via filesystem fallback`);

						// Tier 4: Cold-start app-server — last resort when filesystem also empty.
						if (threadData.length === 0) {
							try {
								const coldClient = await ctx.ensureCodexClient();
								const rpcResult: any = await coldClient.request("thread/list", {});
								threadData = rpcResult?.data ?? [];
								nextCursor = rpcResult?.nextCursor ?? null;
								ctx.logInfo(`[cx_list_threads] Recovered ${threadData.length} threads via cold thread/list`);
							} catch (coldErr: any) {
								ctx.logInfo(`[cx_list_threads] Cold thread/list fallback unavailable: ${coldErr?.message ?? coldErr}`);
							}
						}
					}
				}
			} catch (e: any) {
				// RPC failed — fall back to filesystem
				ctx.logError(`[cx_list_threads] RPC failed, falling back to filesystem:`, e?.message);
				try {
					threadData = await ctx.codexFs.listThreadsFromFs(message.cwd ?? undefined);
					nextCursor = null;
				} catch (fsErr: any) {
					ctx.logError(`[cx_list_threads] Filesystem fallback also failed:`, fsErr?.message);
					threadData = [];
					nextCursor = null;
				}
			}

			// Merge any known thread names from thread/name/updated notifications
			const threadsWithNames =
				ctx.cxThreadNames.size > 0
					? threadData.map((t: any) => {
							const name = ctx.cxThreadNames.get(t.id);
							return name ? { ...t, threadName: name } : t;
						})
					: threadData;

			// Enrich threads with diff stats from filesystem (cached by mtime).
			// Fire-and-forget: don't block the thread list response — stats enrichment
			// can trigger slow filesystem scans when SQLite is locked by the app-server.
			ctx.codexFs.enrichThreadsWithStats(threadsWithNames).catch((e: any) => {
				ctx.logError("[cx_list_threads] Stats enrichment failed (non-fatal):", e?.message ?? e);
			});

			// Update cache
			ctx.cxThreadCache.set(cacheKey, {
				data: threadsWithNames,
				fetchedAt: Date.now(),
				nextCursor,
			});
			ctx.logInfo(`[cx_list_threads] Done, cached ${threadsWithNames.length} threads`);
			reply({ type: "cx_threads", data: threadsWithNames, nextCursor, requestId: message.requestId });
			reply({
				type: "runtime_sessions",
				backend: "codex",
				data: threadsWithNames.map((thread: CodexThread & { threadName?: string }) =>
					ctx.mapCodexThreadToRuntimeSession(thread),
				),
			});
			return true;
		}

		// ── cx_warmup ────────────────────────────────────────────────────
		case "cx_warmup": {
			// Pre-populate caches from filesystem for instant loading
			// No app-server spawn needed for listing - just file I/O
			ctx.logInfo("[cx_warmup] Starting Codex warmup (filesystem)...");
			reply({ type: "cx_warmup_started", requestId: message.requestId });

			// Fire-and-forget: pre-warm caches from filesystem
			(async () => {
				try {
					// Pre-fetch projects from filesystem
					const projects = await ctx.codexFs.listProjectsFromFs();
					ctx.setProjectCache({ data: projects, fetchedAt: Date.now() });
					ctx.logInfo(`[cx_warmup] Pre-cached ${projects.length} projects from filesystem`);

					// Pre-fetch all threads from filesystem
					const threads = await ctx.codexFs.listThreadsFromFs();
					ctx.cxThreadCache.set("__all__", {
						data: threads,
						fetchedAt: Date.now(),
						nextCursor: null,
					});
					ctx.logInfo(`[cx_warmup] Pre-cached ${threads.length} threads from filesystem`);
				} catch (e) {
					ctx.logError("[cx_warmup] Error:", e);
				}
			})();
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
