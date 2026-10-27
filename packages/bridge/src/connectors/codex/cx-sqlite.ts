/**
 * Codex SQLite Fallback Reader
 *
 * Reads thread metadata directly from Codex's SQLite database when the
 * Codex app-server is not running. This is much faster than scanning
 * 1000+ JSONL rollout files — SQLite provides indexed queries with
 * pagination, filtering, and search.
 *
 * Database location: ~/.codex/state_5.sqlite
 * Override: CODEX_SQLITE_HOME env var
 *
 * Uses Bun's built-in bun:sqlite — no additional dependencies required.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { CodexThread, ProjectSummary } from "../../types";
import { sessionPreview } from "../../utils/session-preview";

// ---------------------------------------------------------------------------
// DB location
// ---------------------------------------------------------------------------

const STATE_DB_FILENAME = "state_5.sqlite";

/** Resolve the path to Codex's state SQLite database. */
export function findCodexStateDbPath(): string | null {
	const sqliteHome = process.env.CODEX_SQLITE_HOME;
	const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
	const base = sqliteHome ?? codexHome;

	const dbPath = join(base, STATE_DB_FILENAME);
	return existsSync(dbPath) ? dbPath : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type DbRow = Record<string, unknown>;

/**
 * How long a read waits for the writer that holds the database (Codex itself) to release it. Without
 * this SQLite returns `SQLITE_BUSY` at once, which the callers see as a broken index.
 */
const DB_BUSY_TIMEOUT_MS = 250;

function openDb(dbPath: string): Database | null {
	let db: Database | null = null;
	try {
		db = new Database(dbPath, { readonly: true });
		db.exec(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
		return db;
	} catch {
		db?.close();
		return null;
	}
}

function num(v: unknown): number {
	return typeof v === "number" ? v : 0;
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function strOrUndefined(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapThreadRow(row: DbRow): CodexThread {
	const gitBranch = strOrUndefined(row.git_branch as string);
	return {
		id: str(row.id),
		preview:
			sessionPreview(str(row.first_user_message)) ||
			sessionPreview(str(row.title)) ||
			`Thread ${str(row.id).slice(0, 8)}`,
		modelProvider: strOrUndefined(row.model_provider as string),
		createdAt: num(row.created_at),
		updatedAt: num(row.updated_at) || num(row.created_at),
		cwd: str(row.cwd),
		cliVersion: strOrUndefined(row.cli_version as string),
		source: strOrUndefined(row.source as string),
		gitInfo: gitBranch ? { branch: gitBranch } : null,
		...(strOrUndefined(row.agent_nickname as string) ? { agentNickname: str(row.agent_nickname) } : {}),
		...(strOrUndefined(row.agent_role as string) ? { agentRole: str(row.agent_role) } : {}),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Threads one unpaged listing returns; 0 in `limit` reads every row. */
export const DEFAULT_CX_THREAD_LIMIT = 200;

export type CxSqliteListOptions = {
	cwd?: string;
	limit?: number;
	archived?: boolean;
	searchTerm?: string;
	sortKey?: "created_at" | "updated_at";
	sourceKinds?: string[];
	modelProviders?: string[];
};

/**
 * List threads directly from the Codex SQLite database.
 * Supports filtering, search, pagination — same capabilities as the
 * app-server's thread/list RPC but without needing the process running.
 *
 * Returns an empty array if the database doesn't exist or can't be opened.
 */
export function listThreadsFromDb(options?: CxSqliteListOptions, dbPath?: string): CodexThread[] {
	const resolvedPath = dbPath ?? findCodexStateDbPath();
	if (!resolvedPath) return [];

	const db = openDb(resolvedPath);
	if (!db) return [];

	try {
		const conditions: string[] = [];
		const params: (string | number | boolean | null)[] = [];

		// Filter: cwd
		if (options?.cwd) {
			conditions.push("cwd = ?");
			params.push(options.cwd);
		}

		// Filter: archived
		if (options?.archived === true) {
			conditions.push("archived = 1");
		} else if (options?.archived === false) {
			conditions.push("archived = 0");
		}
		// Default: show all (both archived and non-archived)

		// Filter: search
		if (options?.searchTerm) {
			conditions.push("(title LIKE ? OR first_user_message LIKE ?)");
			const term = `%${options.searchTerm}%`;
			params.push(term, term);
		}

		// Filter: source kinds
		if (options?.sourceKinds && options.sourceKinds.length > 0) {
			const placeholders = options.sourceKinds.map(() => "?").join(", ");
			conditions.push(`source IN (${placeholders})`);
			params.push(...options.sourceKinds);
		}

		// Filter: model providers
		if (options?.modelProviders && options.modelProviders.length > 0) {
			const placeholders = options.modelProviders.map(() => "?").join(", ");
			conditions.push(`model_provider IN (${placeholders})`);
			params.push(...options.modelProviders);
		}

		// Note: has_user_event is often 0 even for real sessions (backfill lag),
		// so we don't filter on it. Instead we filter out empty titles.
		conditions.push("title != ''");

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const sortCol = options?.sortKey === "created_at" ? "created_at" : "updated_at";
		const limit = options?.limit ?? DEFAULT_CX_THREAD_LIMIT;

		const sql = `
      SELECT id, rollout_path, created_at, updated_at, source, model_provider,
             cwd, title, first_user_message, archived, git_branch, git_origin_url,
             cli_version, agent_nickname, agent_role
      FROM threads
      ${where}
      ORDER BY ${sortCol} DESC
      ${limit > 0 ? "LIMIT ?" : ""}
    `;
		if (limit > 0) params.push(limit);

		const rows = db.query(sql).all(...params) as DbRow[];
		return rows.map(mapThreadRow);
	} finally {
		db.close();
	}
}

/**
 * Derive unique projects from thread cwd values in the Codex SQLite database.
 * Returns an empty array if the database doesn't exist or can't be opened.
 */
export function listProjectsFromDb(dbPath?: string): ProjectSummary[] {
	const resolvedPath = dbPath ?? findCodexStateDbPath();
	if (!resolvedPath) return [];

	const db = openDb(resolvedPath);
	if (!db) return [];

	try {
		// Get unique cwds with the most recent updated_at for each. An untitled thread counts too:
		// its rollout file belongs to the same project as the titled ones.
		const rows = db
			.query(`
        SELECT cwd, MAX(updated_at) as last_updated
        FROM threads
        WHERE cwd != ''
        GROUP BY cwd
        ORDER BY last_updated DESC
      `)
			.all() as DbRow[];

		return rows.map((row) => {
			const path = str(row.cwd);
			const name = basename(path) || path;
			return {
				id: path,
				name,
				path,
				lastOpened: num(row.last_updated),
			};
		});
	} finally {
		db.close();
	}
}

/** Batch form of `findRolloutPathById`: one database open for a whole page of threads. */
export function findRolloutPathsByIds(threadIds: string[], dbPath?: string): Map<string, string> {
	const resolved = new Map<string, string>();
	if (threadIds.length === 0) return resolved;

	const resolvedPath = dbPath ?? findCodexStateDbPath();
	if (!resolvedPath) return resolved;

	const db = openDb(resolvedPath);
	if (!db) return resolved;

	try {
		const chunkSize = 400;
		for (let start = 0; start < threadIds.length; start += chunkSize) {
			const chunk = threadIds.slice(start, start + chunkSize);
			const placeholders = chunk.map(() => "?").join(", ");
			const rows = db
				.query(`SELECT id, rollout_path FROM threads WHERE id IN (${placeholders})`)
				.all(...chunk) as DbRow[];
			for (const row of rows) {
				const id = str(row.id);
				const rolloutPath = str(row.rollout_path);
				if (id && rolloutPath && existsSync(rolloutPath)) resolved.set(id, rolloutPath);
			}
		}
	} finally {
		db.close();
	}
	return resolved;
}

/**
 * Find the rollout file path for a given thread ID.
 * This allows the filesystem reader to skip scanning all files.
 */
export function findRolloutPathById(threadId: string, dbPath?: string): string | null {
	const resolvedPath = dbPath ?? findCodexStateDbPath();
	if (!resolvedPath) return null;

	const db = openDb(resolvedPath);
	if (!db) return null;

	try {
		const row = db.query("SELECT rollout_path FROM threads WHERE id = ?").get(threadId) as DbRow | null;

		if (!row) return null;
		const rolloutPath = str(row.rollout_path);
		return rolloutPath && existsSync(rolloutPath) ? rolloutPath : null;
	} finally {
		db.close();
	}
}
