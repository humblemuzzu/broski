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

function openDb(dbPath: string): Database | null {
	try {
		return new Database(dbPath, { readonly: true });
	} catch {
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
			str(row.first_user_message).slice(0, 300) || str(row.title).slice(0, 300) || `Thread ${str(row.id).slice(0, 8)}`,
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
		const limit = options?.limit ?? 200;

		const sql = `
      SELECT id, rollout_path, created_at, updated_at, source, model_provider,
             cwd, title, first_user_message, archived, git_branch, git_origin_url,
             cli_version, agent_nickname, agent_role
      FROM threads
      ${where}
      ORDER BY ${sortCol} DESC
      LIMIT ?
    `;
		params.push(limit);

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
		// Get unique cwds with the most recent updated_at for each
		const rows = db
			.query(`
        SELECT cwd, MAX(updated_at) as last_updated
        FROM threads
        WHERE cwd != '' AND title != ''
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
