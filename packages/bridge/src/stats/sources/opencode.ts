import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StatsHarness } from "../../contract";
import { normalizeModelName, safeNum, type TurnEvent } from "../types";

const PAGE_SIZE = 64;

export interface OpencodeScanContext {
	readonly getWatermark: (key: string) => string | undefined;
	readonly setWatermark: (key: string, value: string) => void;
	readonly hasDedup: (harness: StatsHarness, key: string) => boolean;
	readonly setDedup: (harness: StatsHarness, key: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
	readonly flush?: () => void;
}

interface RawMessageRow {
	id: string;
	session_id: string;
	parent_id: string;
	directory: string;
	agent: string;
	provider: string;
	model: string;
	input: number;
	output: number;
	reasoning: number;
	cache_read: number;
	cache_write: number;
	cost: number;
	created_ms: number;
	completed_ms: number;
	variant: string;
	error_name: string;
}

export function scanOpencode(home: string, ctx: OpencodeScanContext): { files: number; parsed: number; bytes: number } {
	if (!existsSync(home)) return { files: 0, parsed: 0, bytes: 0 };
	const dbFiles = listDatabases(home);
	let files = dbFiles.length;
	let parsed = 0;
	let bytes = 0;

	for (const dbPath of dbFiles) {
		const stamp = dbStatStamp(dbPath);
		if (!stamp) continue;
		bytes += stamp.size;
		const wmKey = `opencode:db:${dbPath}`;
		if (ctx.getWatermark(wmKey) === stamp.key) continue;
		readOpencodeDb(dbPath, ctx);
		ctx.setWatermark(wmKey, stamp.key);
		parsed++;
	}

	const legacyDir = join(home, "storage", "message");
	if (existsSync(legacyDir)) {
		const res = scanLegacyMessages(legacyDir, ctx);
		files += res.files;
		parsed += res.parsed;
	}
	return { files, parsed, bytes };
}

function listDatabases(home: string): string[] {
	try {
		return readdirSync(home)
			.filter((n) => /^opencode(-[A-Za-z0-9._-]+)?\.db$/.test(n))
			.sort()
			.map((n) => join(home, n));
	} catch {
		return [];
	}
}

function dbStatStamp(dbPath: string): { key: string; size: number } | undefined {
	try {
		const main = statSync(dbPath);
		let walStamp = "";
		try {
			const wal = statSync(`${dbPath}-wal`);
			walStamp = `:${wal.size}:${wal.mtimeMs}`;
		} catch {
			// WAL may not exist when idle.
		}
		return { key: `${main.dev}:${main.ino}:${main.size}:${main.mtimeMs}${walStamp}`, size: main.size };
	} catch {
		return undefined;
	}
}

function readOpencodeDb(dbPath: string, ctx: OpencodeScanContext): void {
	let db: Database;
	try {
		db = new Database(dbPath, { readonly: true });
		db.run("PRAGMA busy_timeout = 100");
		db.run("PRAGMA cache_size = -1000");
	} catch {
		return;
	}
	try {
		const tables = new Set(
			db
				.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((r) => r.name),
		);
		const sessions = readSessionMap(db, tables);
		if (tables.has("message")) {
			streamMessageTable(db, sessions, false, ctx);
		}
		if (tables.has("session_message")) {
			streamMessageTable(db, sessions, true, ctx);
		}
	} catch {
		// Corrupted or mid-migration DB skipped without failing other sources.
	} finally {
		db.close(false);
	}
}

function readSessionMap(
	db: Database,
	tables: ReadonlySet<string>,
): Map<string, { parent: string; dir: string; agent: string }> {
	const map = new Map<string, { parent: string; dir: string; agent: string }>();
	for (const table of ["session", "session_v2"]) {
		if (!tables.has(table)) continue;
		const cols = new Set(
			db
				.query<{ name: string }, []>(`PRAGMA table_info(${table})`)
				.all()
				.map((c) => c.name),
		);
		const agentExpr = cols.has("agent") ? "COALESCE(agent, '')" : "''";
		const rows = db
			.query<{ id: string; parent_id: string; directory: string; agent: string }, []>(
				`SELECT id, COALESCE(parent_id, '') AS parent_id, COALESCE(directory, '') AS directory, ${agentExpr} AS agent FROM ${table}`,
			)
			.all();
		for (const r of rows) {
			if (!map.has(r.id)) map.set(r.id, { parent: r.parent_id, dir: r.directory, agent: r.agent });
		}
	}
	return map;
}

function streamMessageTable(
	db: Database,
	sessions: ReadonlyMap<string, { parent: string; dir: string; agent: string }>,
	v2: boolean,
	ctx: OpencodeScanContext,
): void {
	const query = v2
		? `SELECT rowid AS row_id, id, session_id,
			COALESCE(json_extract(data, '$.model.providerID'), '') AS provider,
			COALESCE(json_extract(data, '$.model.id'), '') AS model,
			COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
			COALESCE(json_extract(data, '$.tokens.output'), 0) AS output,
			COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS reasoning,
			COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cache_read,
			COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cache_write,
			COALESCE(json_extract(data, '$.cost'), 0) AS cost,
			COALESCE(json_extract(data, '$.time.created'), time_created, 0) AS created_ms,
			COALESCE(json_extract(data, '$.time.completed'), 0) AS completed_ms,
			COALESCE(json_extract(data, '$.model.variant'), '') AS variant,
			COALESCE(json_extract(data, '$.error.name'), '') AS error_name,
			COALESCE(json_extract(data, '$.agent'), '') AS agent
		   FROM session_message WHERE type = 'assistant' AND rowid > ? ORDER BY rowid LIMIT ?`
		: `SELECT rowid AS row_id, id, session_id,
			COALESCE(json_extract(data, '$.providerID'), '') AS provider,
			COALESCE(json_extract(data, '$.modelID'), '') AS model,
			COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
			COALESCE(json_extract(data, '$.tokens.output'), 0) AS output,
			COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS reasoning,
			COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cache_read,
			COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cache_write,
			COALESCE(json_extract(data, '$.cost'), 0) AS cost,
			COALESCE(json_extract(data, '$.time.created'), time_created, 0) AS created_ms,
			COALESCE(json_extract(data, '$.time.completed'), 0) AS completed_ms,
			COALESCE(json_extract(data, '$.variant'), '') AS variant,
			COALESCE(json_extract(data, '$.error.name'), '') AS error_name,
			COALESCE(json_extract(data, '$.agent'), '') AS agent
		   FROM message WHERE json_extract(data, '$.role') = 'assistant' AND rowid > ? ORDER BY rowid LIMIT ?`;

	const stmt = db.prepare(query);
	let afterRowId = 0;
	for (;;) {
		const rows = stmt.all(afterRowId, PAGE_SIZE) as Array<
			Omit<RawMessageRow, "parent_id" | "directory"> & { row_id: number }
		>;
		const last = rows.at(-1);
		if (!last) break;
		afterRowId = last.row_id;
		for (const row of rows) {
			const meta = sessions.get(row.session_id);
			const rootId = resolveRootSession(row.session_id, sessions);
			const rootMeta = sessions.get(rootId);
			emitOpencodeRow(
				{
					...row,
					parent_id: meta?.parent ?? "",
					directory: rootMeta?.dir || meta?.dir || "",
					agent: row.agent || meta?.agent || "",
				},
				rootId,
				ctx,
			);
		}
		if (rows.length < PAGE_SIZE) break;
		ctx.flush?.();
	}
	ctx.flush?.();
}

function resolveRootSession(
	id: string,
	sessions: ReadonlyMap<string, { parent: string; dir: string; agent: string }>,
): string {
	let cur = id;
	for (let i = 0; i < 16; i++) {
		const parent = sessions.get(cur)?.parent;
		if (!parent || !sessions.has(parent)) break;
		cur = parent;
	}
	return cur;
}

function emitOpencodeRow(row: RawMessageRow, rootSessionId: string, ctx: OpencodeScanContext): void {
	const input = safeNum(row.input);
	const output = safeNum(row.output);
	const reasoning = safeNum(row.reasoning);
	const cacheRead = safeNum(row.cache_read);
	const cacheWrite = safeNum(row.cache_write);
	const totalOutput = output + reasoning;
	if (input + totalOutput + cacheRead + cacheWrite === 0) return;

	// Skip rows that were proxied through Claude Code when Claude's own logs already hold them.
	if (row.provider === "claude-agent" && ctx.hasDedup("claude", `main:${row.id}`)) return;

	const idKey = `id:${row.id}`;
	const fpKey = `${row.completed_ms || row.created_ms}:${input}:${output}:${cacheRead}:${cacheWrite}`;
	if (ctx.hasDedup("opencode", idKey) || ctx.hasDedup("opencode", fpKey)) return;
	ctx.setDedup("opencode", idKey);
	ctx.setDedup("opencode", fpKey);

	const { provider, model } = normalizeModelName(row.provider, row.model || "unknown");
	const ms = safeNum(row.created_ms) || safeNum(row.completed_ms);
	if (ms <= 0) return;
	const reportedCost = safeNum(row.cost) > 0 ? safeNum(row.cost) : undefined;
	const isSubagent = Boolean(row.parent_id);
	let subagentRunStart = false;
	if (isSubagent) {
		const runKey = `subrun:${row.session_id}`;
		if (!ctx.hasDedup("opencode", runKey)) {
			ctx.setDedup("opencode", runKey);
			subagentRunStart = true;
		}
	}

	ctx.emitTurn({
		harness: "opencode",
		sessionKey: `opencode:${rootSessionId}`,
		sessionId: rootSessionId,
		cwd: row.directory,
		ms,
		model,
		provider,
		thinking: row.variant && row.variant !== "default" ? row.variant : "unknown",
		speedTier: "standard",
		tokens: {
			uncachedInput: input,
			cachedInput: cacheRead,
			cacheCreation: cacheWrite,
			cacheCreation1h: 0,
			output: totalOutput,
			reasoning,
		},
		reportedCostUsd: reportedCost,
		durationMs: 0,
		error: Boolean(row.error_name && row.error_name !== "MessageAbortedError"),
		extra: false,
		afterCompaction: false,
		isSubagent,
		subagentName: isSubagent ? (row.agent || "subagent").slice(0, 48) : undefined,
		subagentRunStart,
		subagentFailed: false,
	});
}

function scanLegacyMessages(rootDir: string, ctx: OpencodeScanContext): { files: number; parsed: number } {
	let dirs: string[];
	try {
		dirs = readdirSync(rootDir).sort();
	} catch {
		return { files: 0, parsed: 0 };
	}
	const stamp = `${statSync(rootDir).mtimeMs}:${dirs.length}`;
	const wmKey = `opencode:legacy:${rootDir}`;
	if (ctx.getWatermark(wmKey) === stamp) return { files: dirs.length, parsed: 0 };

	let parsed = 0;
	for (const sid of dirs) {
		const dirPath = join(rootDir, sid);
		let names: string[];
		try {
			names = readdirSync(dirPath).filter((n) => n.endsWith(".json"));
		} catch {
			continue;
		}
		for (const name of names) {
			try {
				const d = JSON.parse(readFileSync(join(dirPath, name), "utf8")) as Record<string, unknown>;
				if (d.role !== "assistant") continue;
				const tokens = (d.tokens as Record<string, unknown> | undefined) ?? {};
				const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
				const time = (d.time as Record<string, unknown> | undefined) ?? {};
				const pathObj = (d.path as Record<string, unknown> | undefined) ?? {};
				const errObj = (d.error as Record<string, unknown> | undefined) ?? {};
				emitOpencodeRow(
					{
						id: name.slice(0, -5),
						session_id: sid,
						parent_id: "",
						directory: String(pathObj.root ?? pathObj.cwd ?? ""),
						agent: String(d.agent ?? d.mode ?? ""),
						provider: String(d.providerID ?? ""),
						model: String(d.modelID ?? ""),
						input: safeNum(tokens.input),
						output: safeNum(tokens.output),
						reasoning: safeNum(tokens.reasoning),
						cache_read: safeNum(cache.read),
						cache_write: safeNum(cache.write),
						cost: safeNum(d.cost),
						created_ms: safeNum(time.created),
						completed_ms: safeNum(time.completed),
						variant: String(d.variant ?? ""),
						error_name: String(errObj.name ?? ""),
					},
					sid,
					ctx,
				);
			} catch {
				// Skip malformed legacy message files.
			}
		}
		parsed++;
	}
	ctx.setWatermark(wmKey, stamp);
	return { files: dirs.length, parsed };
}
