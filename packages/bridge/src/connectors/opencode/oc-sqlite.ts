/**
 * OpenCode SQLite Fallback Reader
 *
 * Reads session and project data directly from OpenCode's SQLite database
 * when the OpenCode HTTP server is not running. Read-only access — we never
 * write to the database.
 *
 * Database location:
 *   macOS:  ~/Library/Application Support/opencode/opencode.db
 *   Linux:  ~/.local/share/opencode/opencode.db
 *
 * Uses Bun's built-in bun:sqlite — no additional dependencies required.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { ProjectSummary, SessionSummary } from "../../types";
import { slimSessionSummary } from "./session-summary";

// ---------------------------------------------------------------------------
// DB location
// ---------------------------------------------------------------------------

/** Resolve the path to OpenCode's SQLite database. */
export function findOpenCodeDbPath(): string | null {
	const home = homedir();
	const os = platform();

	// OpenCode uses xdg-basedir: on macOS the XDG_DATA_HOME default is
	// ~/Library/Application Support, on Linux ~/.local/share.
	const candidates: string[] = [];

	// Respect XDG_DATA_HOME if set (cross-platform).
	if (process.env.XDG_DATA_HOME) {
		candidates.push(join(process.env.XDG_DATA_HOME, "opencode", "opencode.db"));
	}

	if (os === "darwin") {
		candidates.push(join(home, "Library", "Application Support", "opencode", "opencode.db"));
	}

	// Linux / fallback
	candidates.push(join(home, ".local", "share", "opencode", "opencode.db"));

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
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

function parseJsonSafe<T = unknown>(v: unknown): T | undefined {
	if (typeof v !== "string" || v.length === 0) return undefined;
	try {
		return JSON.parse(v) as T;
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapProjectRow(row: DbRow): ProjectSummary {
	const worktree = str(row.worktree);
	const parts = worktree.split("/").filter(Boolean);
	const fallbackName = parts.length > 0 ? parts[parts.length - 1]! : worktree;
	return {
		id: str(row.id),
		name: strOrUndefined(row.name as string) ?? fallbackName,
		path: worktree,
		lastOpened: num(row.time_initialized) || num(row.time_updated) || num(row.time_created),
	};
}

function mapSessionRow(row: DbRow, projectRow?: DbRow): SessionSummary {
	return slimSessionSummary(rawSessionRow(row, projectRow));
}

function rawSessionRow(row: DbRow, projectRow?: DbRow): SessionSummary {
	const additions = num(row.summary_additions);
	const deletions = num(row.summary_deletions);
	const files = num(row.summary_files);
	const hasSummary = additions > 0 || deletions > 0 || files > 0;

	const shareUrl = strOrUndefined(row.share_url as string);
	const revert = parseJsonSafe<SessionSummary["revert"]>(row.revert);
	const permission = parseJsonSafe<SessionSummary["permission"]>(row.permission);

	return {
		id: str(row.id),
		slug: strOrUndefined(row.slug as string),
		title: str(row.title),
		projectID: str(row.project_id),
		workspaceID: strOrUndefined(row.workspace_id as string),
		directory: str(row.directory),
		parentID: strOrUndefined(row.parent_id as string),
		time: {
			created: num(row.time_created),
			updated: num(row.time_updated),
			...(num(row.time_compacting) ? { compacting: num(row.time_compacting) } : {}),
			...(num(row.time_archived) ? { archived: num(row.time_archived) } : {}),
		},
		...(hasSummary ? { summary: { additions, deletions, files } } : {}),
		...(shareUrl ? { share: { url: shareUrl } } : {}),
		...(revert ? { revert } : {}),
		...(permission ? { permission } : {}),
		...(projectRow
			? {
					project: {
						id: str(projectRow.id),
						name: strOrUndefined(projectRow.name as string),
						worktree: str(projectRow.worktree),
					},
				}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OcSqliteListOptions = {
	directory?: string;
	roots?: boolean;
	start?: number;
	search?: string;
	/** 0 reads every row, for a caller that cuts its own page. */
	limit?: number;
	archived?: boolean;
};

/**
 * List projects directly from the OpenCode SQLite database.
 * Returns an empty array if the database doesn't exist or can't be opened.
 */
export function listProjectsFromDb(dbPath?: string): ProjectSummary[] {
	const resolvedPath = dbPath ?? findOpenCodeDbPath();
	if (!resolvedPath) return [];

	const db = openDb(resolvedPath);
	if (!db) return [];

	try {
		const rows = db
			.query(
				"SELECT id, worktree, name, time_created, time_updated, time_initialized FROM project ORDER BY time_updated DESC",
			)
			.all() as DbRow[];
		return rows.map(mapProjectRow);
	} finally {
		db.close();
	}
}

/**
 * List sessions directly from the OpenCode SQLite database.
 * Supports the same filter options as the HTTP API.
 * Returns an empty array if the database doesn't exist or can't be opened.
 */
export function listSessionsFromDb(options?: OcSqliteListOptions, dbPath?: string): SessionSummary[] {
	const resolvedPath = dbPath ?? findOpenCodeDbPath();
	if (!resolvedPath) return [];

	const db = openDb(resolvedPath);
	if (!db) return [];

	try {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (options?.directory) {
			conditions.push("s.directory = ?");
			params.push(options.directory);
		}

		if (options?.roots) {
			conditions.push("s.parent_id IS NULL");
		}

		if (options?.start) {
			conditions.push("s.time_updated >= ?");
			params.push(options.start);
		}

		if (options?.search) {
			conditions.push("s.title LIKE ?");
			params.push(`%${options.search}%`);
		}

		if (options?.archived === true) {
			conditions.push("s.time_archived IS NOT NULL");
		} else if (options?.archived === false || options?.archived === undefined) {
			// Default to non-archived, matching the HTTP API's default behavior.
			conditions.push("s.time_archived IS NULL");
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = options?.limit ?? 200;

		const sql = `
      SELECT s.*, p.id AS p_id, p.worktree AS p_worktree, p.name AS p_name
      FROM session s
      LEFT JOIN project p ON s.project_id = p.id
      ${where}
      ORDER BY s.time_updated DESC
      ${limit > 0 ? "LIMIT ?" : ""}
    `;
		if (limit > 0) params.push(limit);

		const rows = db.query(sql).all(...(params as (string | number | bigint | boolean | null)[])) as DbRow[];

		return rows.map((row) => {
			const projectRow = row.p_id ? { id: row.p_id, worktree: row.p_worktree, name: row.p_name } : undefined;
			return mapSessionRow(row, projectRow as DbRow | undefined);
		});
	} finally {
		db.close();
	}
}

/**
 * Get messages for a specific session from the SQLite database.
 * Returns raw message data objects (parsed from the JSON `data` column).
 */
export function getSessionMessagesFromDb(sessionId: string, dbPath?: string): unknown[] {
	const resolvedPath = dbPath ?? findOpenCodeDbPath();
	if (!resolvedPath) return [];

	const db = openDb(resolvedPath);
	if (!db) return [];

	try {
		const rows = db
			.query("SELECT id, data, time_created, time_updated FROM message WHERE session_id = ? ORDER BY time_created ASC")
			.all(sessionId) as DbRow[];

		return rows.map((row) => {
			const data = parseJsonSafe<Record<string, unknown>>(row.data) ?? {};
			return {
				id: str(row.id),
				sessionID: sessionId,
				...data,
				time: {
					created: num(row.time_created),
					updated: num(row.time_updated),
				},
			};
		});
	} finally {
		db.close();
	}
}
