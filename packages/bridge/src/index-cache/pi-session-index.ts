/**
 * The Pi session index: per-file summaries in memory, persisted as one JSON-lines file under the cache
 * root. A record is reused while its file keeps the same `(mtimeMs, size, ino)` stamp, so a bridge
 * restart only stats the session files and recomputes the ones that changed.
 *
 * One instance exists per cache file, shared by the background warm and by listings, so concurrent
 * callers never load or write the same index twice.
 */

import { indexCacheFilePath } from "./index-cache-root";
import { type IndexCacheOptions, readIndexCacheLines, writeIndexCacheLines } from "./index-cache-store";
import {
	encodePiSessionIndexRecord,
	PI_SESSION_INDEX_FILE,
	PI_SESSION_INDEX_MAX_BYTES,
	PI_SESSION_INDEX_SCHEMA,
	type PiSessionFileStamp,
	type PiSessionIndexRecord,
	parsePiSessionIndexRecord,
	sessionFileStampMatches,
} from "./pi-session-index-record";

export type PiSessionIndexOptions = {
	/** Directory holding the index file; defaults to the resolved cache root. */
	cacheRoot?: string;
	maxIndexBytes?: number;
};

export type PiSessionIndexStats = {
	entries: number;
	loadedFromDisk: number;
	writes: number;
};

export class PiSessionIndex {
	private readonly options: IndexCacheOptions;
	private records: Map<string, PiSessionIndexRecord>;
	private dirty = false;
	private writes = 0;
	private readonly loadedFromDisk: number;

	constructor(options: IndexCacheOptions, records: PiSessionIndexRecord[]) {
		this.options = options;
		this.records = new Map(records.map((record) => [record.path, record]));
		this.loadedFromDisk = records.length;
	}

	lookup(path: string, stamp: PiSessionFileStamp): PiSessionIndexRecord | undefined {
		const record = this.records.get(path);
		if (!record) return undefined;
		return sessionFileStampMatches(record, stamp) ? record : undefined;
	}

	put(record: PiSessionIndexRecord): void {
		const previous = this.records.get(record.path);
		if (previous && isSameRecord(previous, record)) return;
		this.records.set(record.path, record);
		this.dirty = true;
	}

	/** Drops records whose file the caller did not see, so deleted sessions leave the index. */
	pruneMissing(livePaths: ReadonlySet<string>): void {
		for (const path of this.records.keys()) {
			if (livePaths.has(path)) continue;
			this.records.delete(path);
			this.dirty = true;
		}
	}

	get size(): number {
		return this.records.size;
	}

	stats(): PiSessionIndexStats {
		return { entries: this.records.size, loadedFromDisk: this.loadedFromDisk, writes: this.writes };
	}

	/** Writes the whole index when anything changed; newest record first so the budget drops the oldest. */
	async flush(): Promise<boolean> {
		if (!this.dirty) return false;
		const ordered = [...this.records.values()].sort((a, b) => b.at - a.at);
		const written = await writeIndexCacheLines(
			this.options,
			ordered.map((record) => encodePiSessionIndexRecord(record)),
		);
		if (written < ordered.length) {
			this.records = new Map(ordered.slice(0, written).map((record) => [record.path, record]));
		}
		if (written > 0) {
			this.dirty = false;
			this.writes++;
		}
		return written > 0;
	}
}

function isSameRecord(a: PiSessionIndexRecord, b: PiSessionIndexRecord): boolean {
	return a.at === b.at && sessionFileStampMatches(a, b);
}

const indexes = new Map<string, Promise<PiSessionIndex>>();

function indexOptions(options: PiSessionIndexOptions): IndexCacheOptions {
	return {
		path: indexCacheFilePath(PI_SESSION_INDEX_FILE, options.cacheRoot),
		schema: PI_SESSION_INDEX_SCHEMA,
		maxBytes: options.maxIndexBytes ?? PI_SESSION_INDEX_MAX_BYTES,
	};
}

async function load(options: PiSessionIndexOptions): Promise<PiSessionIndex> {
	const resolved = indexOptions(options);
	const records = await readIndexCacheLines(resolved, parsePiSessionIndexRecord);
	return new PiSessionIndex(resolved, records);
}

/** The shared index for a cache root; the first call reads it off disk. */
export function openPiSessionIndex(options: PiSessionIndexOptions = {}): Promise<PiSessionIndex> {
	const key = indexOptions(options).path;
	const existing = indexes.get(key);
	if (existing) return existing;

	const loading = load(options);
	indexes.set(key, loading);
	return loading;
}

/** Forgets the in-memory instances so the next call reads the file again (tests, benches). */
export function forgetPiSessionIndex(): void {
	indexes.clear();
}
