import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeModelName, type TurnEvent } from "../types";

export interface AntigravityScanContext {
	readonly getWatermark: (key: string) => string | undefined;
	readonly setWatermark: (key: string, value: string) => void;
	readonly hasDedup: (key: string) => boolean;
	readonly setDedup: (key: string) => void;
	readonly emitTurn: (turn: TurnEvent) => void;
	readonly flush?: () => void;
}

type FieldValue = number | Uint8Array;
type ProtoFields = Map<number, FieldValue[]>;

const MODEL_IDS: Readonly<Record<number, string>> = {
	246: "gemini-2.5-pro",
	281: "claude-sonnet-4",
	282: "claude-sonnet-4",
	290: "claude-opus-4",
	291: "claude-opus-4",
	312: "gemini-2.5-flash",
	313: "gemini-2.5-flash",
	329: "gemini-2.5-flash",
	330: "gemini-2.5-flash",
	333: "claude-sonnet-4-5",
	334: "claude-sonnet-4-5",
	340: "claude-haiku-4-5",
	341: "claude-haiku-4-5",
	1016: "gemini-3-pro-preview",
	1018: "gemini-3-flash-preview",
	1026: "claude-opus-4-6",
	1035: "claude-sonnet-4-6",
	1036: "gemini-3-pro-preview",
	1037: "gemini-3-pro-preview",
	1047: "gemini-3-flash-preview",
	1084: "gemini-3-flash-preview",
	1318: "gemini-3.8-flash",
	1319: "gemini-3.8-flash",
	1320: "gemini-3.8-flash",
	1322: "gemini-3.8-flash",
	1402: "claude-opus-5-5",
	1417: "gemini-4-argon",
	1418: "gemini-4-argon",
	1419: "gemini-4-argon",
	1537: "gemini-4-neon",
};

interface DecodedMeta {
	readonly model: string;
	readonly modelId: number;
	readonly timestampMs: number | undefined;
	readonly usages: ProtoFields[];
}

export function scanAntigravity(
	dirs: readonly string[],
	ctx: AntigravityScanContext,
): { files: number; parsed: number; bytes: number } {
	const dbFiles: string[] = [];
	for (const root of dirs) {
		const conv = join(root, "conversations");
		if (existsSync(conv)) collectDbs(conv, dbFiles);
	}
	let parsed = 0;
	let bytes = 0;
	for (const dbPath of dbFiles) {
		const stamp = dbStamp(dbPath);
		if (!stamp) continue;
		bytes += stamp.size;
		const wmKey = `agy:db:${dbPath}`;
		if (ctx.getWatermark(wmKey) === stamp.key) continue;
		readAntigravityDb(dbPath, stamp.mtimeMs, ctx);
		ctx.setWatermark(wmKey, stamp.key);
		ctx.flush?.();
		parsed++;
	}
	return { files: dbFiles.length, parsed, bytes };
}

function collectDbs(dir: string, out: string[]): void {
	let entries: import("node:fs").Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) collectDbs(full, out);
		else if (e.isFile() && e.name.endsWith(".db")) out.push(full);
	}
}

function dbStamp(dbPath: string): { key: string; size: number; mtimeMs: number } | undefined {
	try {
		const st = statSync(dbPath);
		let wal = "";
		try {
			const w = statSync(`${dbPath}-wal`);
			wal = `:${w.size}:${w.mtimeMs}`;
		} catch {
			// No active WAL.
		}
		return { key: `${st.size}:${st.mtimeMs}:${st.ctimeMs}${wal}`, size: st.size, mtimeMs: st.mtimeMs };
	} catch {
		return undefined;
	}
}

function readAntigravityDb(dbPath: string, fallbackMs: number, ctx: AntigravityScanContext): void {
	let db: Database;
	try {
		db = new Database(dbPath, { readonly: true });
		db.run("PRAGMA busy_timeout = 100");
		db.run("PRAGMA cache_size = -1000");
	} catch {
		return;
	}
	const sessionId = basename(dbPath, ".db");
	try {
		const tables = new Set(
			db
				.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((r) => r.name),
		);
		if (!tables.has("gen_metadata") && !tables.has("steps")) return;

		const generations = tables.has("gen_metadata")
			? readTable(
					db,
					"SELECT rowid AS row_id, idx, data FROM gen_metadata WHERE rowid > ? ORDER BY rowid LIMIT ?",
					1,
					false,
				)
			: [];
		const steps = tables.has("steps")
			? readTable(
					db,
					"SELECT rowid AS row_id, idx, metadata AS data FROM steps WHERE rowid > ? ORDER BY rowid LIMIT ?",
					64,
					true,
				)
			: [];

		let trajectoryMs: number | undefined;
		if (tables.has("trajectory_metadata_blob")) {
			const rows = db.query<{ data: Uint8Array | null }, []>("SELECT data FROM trajectory_metadata_blob").all();
			for (const r of rows) {
				if (!r.data) continue;
				trajectoryMs ??= readTimestamp(nestedField(decodeFields(r.data), 2));
			}
		}

		const learnedModels = new Map<number, string>();
		const genByIdx = new Map<number, DecodedMeta>();
		for (const { idx, entry } of generations) {
			genByIdx.set(idx, entry);
			if (entry.modelId > 0 && isConcreteModel(entry.model)) learnedModels.set(entry.modelId, entry.model);
		}
		for (const { entry } of steps) {
			if (entry.modelId > 0 && isConcreteModel(entry.model)) learnedModels.set(entry.modelId, entry.model);
		}

		const sources: ReadonlyArray<readonly [string, Array<{ idx: number; entry: DecodedMeta }>]> = [
			["step", steps],
			["generation", generations],
		];
		for (const [kind, entries] of sources) {
			for (let idxPos = 0; idxPos < entries.length; idxPos++) {
				const item = entries[idxPos];
				if (!item) continue;
				const { idx, entry } = item;
				const gen = kind === "step" ? genByIdx.get(idx) : undefined;
				for (let uIdx = 0; uIdx < entry.usages.length; uIdx++) {
					const usage = entry.usages[uIdx];
					if (!usage) continue;
					const modelId = numField(usage, 1) || entry.modelId;
					const uncachedInput = numField(usage, 2);
					const cachedInput = numField(usage, 5);
					const cacheCreation = numField(usage, 4);
					const reasoning = numField(usage, 9);
					const output = Math.max(numField(usage, 3), reasoning + numField(usage, 10));
					if (uncachedInput + cachedInput + cacheCreation + output === 0) continue;

					const dedupId = firstText(usage, [11, 12, 7]) || `${sessionId}:${kind}:${idxPos}:${uIdx}`;
					if (ctx.hasDedup(dedupId)) continue;
					ctx.setDedup(dedupId);

					const rawModel = pickModelName(entry, gen, modelId, learnedModels) || `antigravity-${modelId}`;
					const { provider, model } = normalizeModelName("google", rawModel);
					const ms = entry.timestampMs ?? trajectoryMs ?? fallbackMs;

					ctx.emitTurn({
						harness: "antigravity",
						sessionKey: `antigravity:${sessionId}`,
						sessionId,
						cwd: "",
						ms,
						model,
						provider,
						thinking: "unknown",
						speedTier: "standard",
						tokens: {
							uncachedInput,
							cachedInput,
							cacheCreation,
							cacheCreation1h: 0,
							output,
							reasoning: Math.min(output, reasoning),
						},
						reportedCostUsd: undefined,
						durationMs: 0,
						error: false,
						extra: false,
						afterCompaction: false,
						isSubagent: false,
					});
				}
			}
		}
	} catch {
		// Unrecognized or locked conversation DB skipped safely.
	} finally {
		db.close(false);
	}
}

function readTable(
	db: Database,
	sql: string,
	pageRows: number,
	isStep: boolean,
): Array<{ idx: number; entry: DecodedMeta }> {
	const stmt = db.prepare(sql);
	const out: Array<{ idx: number; entry: DecodedMeta }> = [];
	let after = -1;
	for (;;) {
		const rows = stmt.all(after, pageRows) as Array<{ row_id: number; idx: number; data: Uint8Array | null }>;
		for (const row of rows) {
			if (!row.data || row.data.byteLength === 0) continue;
			const meta = decodeMetadataBlob(row.data, isStep);
			if (meta && meta.usages.length > 0) out.push({ idx: row.idx, entry: meta });
		}
		if (rows.length < pageRows) break;
		after = rows[rows.length - 1]?.row_id ?? after + pageRows;
	}
	return out;
}

/** Decodes an Antigravity `gen_metadata.data` (`isStep=false`) or `steps.metadata` (`isStep=true`) blob. */
export function decodeMetadataBlob(bytes: Uint8Array, isStep: boolean): DecodedMeta | undefined {
	try {
		const root = decodeFields(bytes);
		const data = isStep ? root : nestedField(root, 1);
		if (data.size === 0) return undefined;
		const modelFields = isStep ? nestedField(data, 24) : data;
		const usages: ProtoFields[] = [];
		const primary = bytesField(data, isStep ? 9 : 4);
		if (primary) usages.push(decodeFields(primary.slice()));
		for (const retry of data.get(isStep ? 28 : 17) ?? []) {
			if (!(retry instanceof Uint8Array)) continue;
			const retryUsage = bytesField(decodeFields(retry), 2);
			if (retryUsage) usages.push(decodeFields(retryUsage.slice()));
		}
		const names = [textField(modelFields, isStep ? 12 : 19), textField(modelFields, isStep ? 8 : 21)]
			.map(cleanModelName)
			.filter(Boolean);
		const model = names.find(isConcreteModel) ?? names.find((n) => !/^model[_-]/.test(n)) ?? "";
		const modelId = numField(modelFields, isStep ? 1 : 3) || (usages[0] ? numField(usages[0], 1) : 0);
		const timestampMs = isStep
			? (readTimestamp(nestedField(data, 8)) ?? readTimestamp(nestedField(data, 1)))
			: readTimestamp(nestedField(nestedField(data, 9), 4));
		return { model, modelId, timestampMs, usages };
	} catch {
		return undefined;
	}
}

function pickModelName(
	entry: DecodedMeta,
	gen: DecodedMeta | undefined,
	modelId: number,
	learned: ReadonlyMap<number, string>,
): string {
	if (entry.model && (modelId === 0 || entry.modelId === modelId)) return entry.model;
	if (gen?.model && (modelId === 0 || gen.modelId === modelId)) return gen.model;
	return learned.get(modelId) ?? MODEL_IDS[modelId] ?? "";
}

function cleanModelName(name: string): string {
	if (!name) return "";
	const norm = name
		.toLowerCase()
		.replace(/\s*\(([^)]*)\)\s*$/, "-$1")
		.replace(/\s+/g, "-");
	if (norm.startsWith("claude-")) {
		return norm.replace(/^claude-(\d+(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1").replaceAll(".", "-");
	}
	return norm;
}

function isConcreteModel(model: string): boolean {
	return /^(?:gemini-\d|claude-(?:sonnet|opus|haiku|fable)-\d|gpt-)/.test(model);
}

export function decodeFields(bytes: Uint8Array): ProtoFields {
	const result: ProtoFields = new Map();
	let pos = 0;
	const len = bytes.length;
	while (pos < len) {
		const tag = readVarint(bytes, pos);
		if (!tag) break;
		pos = tag.next;
		const field = Math.floor(tag.value / 8);
		const wire = tag.value % 8;
		if (field === 0) break;
		let value: FieldValue | undefined;
		if (wire === 0) {
			const v = readVarint(bytes, pos);
			if (!v) break;
			pos = v.next;
			value = v.value;
		} else if (wire === 2) {
			const sz = readVarint(bytes, pos);
			if (!sz || sz.next + sz.value > len) break;
			value = bytes.subarray(sz.next, sz.next + sz.value);
			pos = sz.next + sz.value;
		} else if (wire === 1) {
			pos += 8;
		} else if (wire === 5) {
			pos += 4;
		} else {
			break;
		}
		if (value !== undefined) {
			const list = result.get(field) ?? [];
			list.push(value);
			result.set(field, list);
		}
	}
	return result;
}

function numField(fields: ProtoFields, key: number): number {
	const v = fields.get(key)?.[0];
	return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function bytesField(fields: ProtoFields, key: number): Uint8Array | undefined {
	const v = fields.get(key)?.[0];
	return v instanceof Uint8Array ? v : undefined;
}

function nestedField(fields: ProtoFields, key: number): ProtoFields {
	const b = bytesField(fields, key);
	return b ? decodeFields(b) : new Map();
}

function textField(fields: ProtoFields, key: number): string {
	const b = bytesField(fields, key);
	if (!b) return "";
	return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("utf8").trim();
}

function firstText(fields: ProtoFields, keys: readonly number[]): string {
	for (const k of keys) {
		const t = textField(fields, k);
		if (t.length >= 4 && t.length <= 128) return t;
	}
	return "";
}

function readTimestamp(fields: ProtoFields): number | undefined {
	const secs = numField(fields, 1);
	return secs > 1_000_000_000 ? secs * 1000 + Math.floor(numField(fields, 2) / 1_000_000) : undefined;
}

function readVarint(buf: Uint8Array, start: number): { value: number; next: number } | undefined {
	let result = 0;
	let shift = 0;
	let pos = start;
	while (pos < buf.length && shift < 56) {
		const b = buf[pos++] ?? 0;
		result += (b & 0x7f) * 2 ** shift;
		if ((b & 0x80) === 0) return { value: result, next: pos };
		shift += 7;
	}
	return undefined;
}
