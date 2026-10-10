/**
 * Path-keyed value cache validated by a single `stat` fingerprint, so a warm read only recomputes
 * when a file's mtime, size, inode or ctime changed (a rename-and-replace is caught by ino/ctime).
 * Concurrent misses on the same path share one compute, and least-recently-used entries are dropped
 * once the estimated byte total passes `byteBudget`.
 */

import { stat } from "node:fs/promises";
import { onMemoryPressure } from "./memory-pressure";
import { singleFlight } from "./single-flight";

export type FileFingerprint = {
	mtimeMs: number;
	size: number;
	ino: number;
	ctimeMs: number;
};

export type FileFingerprintCacheOptions<TValue> = {
	byteBudget: number;
	estimateBytes: (value: TValue) => number;
	/** Drop every cached value when the OS reports `"critical"` memory pressure. */
	shedOnPressure?: boolean;
	/** Injectable for tests; defaults to `stat`. */
	fingerprint?: (path: string) => Promise<FileFingerprint | null>;
};

export type FileFingerprintCacheStats = {
	entries: number;
	bytes: number;
	hits: number;
	misses: number;
};

type Entry<TValue> = {
	fingerprint: FileFingerprint;
	value: TValue;
	bytes: number;
};

async function statFingerprint(path: string): Promise<FileFingerprint | null> {
	try {
		const info = await stat(path);
		return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino, ctimeMs: info.ctimeMs };
	} catch {
		return null;
	}
}

export const fingerprintsMatch = (a: FileFingerprint, b: FileFingerprint): boolean =>
	a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino && a.ctimeMs === b.ctimeMs;

export class FileFingerprintCache<TValue> {
	private readonly entries = new Map<string, Entry<TValue>>();
	private readonly inFlight = new Map<string, Promise<TValue>>();
	private readonly byteBudget: number;
	private readonly estimateBytes: (value: TValue) => number;
	private readonly readFingerprint: (path: string) => Promise<FileFingerprint | null>;
	private readonly unsubscribe: (() => void) | null;
	private bytes = 0;
	private hits = 0;
	private misses = 0;

	constructor(options: FileFingerprintCacheOptions<TValue>) {
		this.byteBudget = options.byteBudget;
		this.estimateBytes = options.estimateBytes;
		this.readFingerprint = options.fingerprint ?? statFingerprint;
		this.unsubscribe = options.shedOnPressure
			? onMemoryPressure((level) => {
					if (level === "critical") this.clear();
				})
			: null;
	}

	get(path: string, compute: () => Promise<TValue>): Promise<TValue> {
		return singleFlight(this.inFlight, path, () => this.resolve(path, compute));
	}

	has(path: string): boolean {
		return this.entries.has(path);
	}

	delete(path: string): boolean {
		const entry = this.entries.get(path);
		if (!entry) return false;
		this.bytes -= entry.bytes;
		return this.entries.delete(path);
	}

	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}

	stats(): FileFingerprintCacheStats {
		return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses };
	}

	dispose(): void {
		this.clear();
		this.unsubscribe?.();
	}

	private async resolve(path: string, compute: () => Promise<TValue>): Promise<TValue> {
		const fingerprint = await this.readFingerprint(path);
		if (fingerprint) {
			const cached = this.entries.get(path);
			if (cached && fingerprintsMatch(cached.fingerprint, fingerprint)) {
				this.hits++;
				this.touch(path, cached);
				return cached.value;
			}
		}

		this.misses++;
		const value = await compute();
		if (fingerprint) this.store(path, fingerprint, value);
		return value;
	}

	private touch(path: string, entry: Entry<TValue>): void {
		this.entries.delete(path);
		this.entries.set(path, entry);
	}

	private store(path: string, fingerprint: FileFingerprint, value: TValue): void {
		this.delete(path);
		const bytes = this.estimateBytes(value);
		this.entries.set(path, { fingerprint, value, bytes });
		this.bytes += bytes;
		this.evict();
	}

	private evict(): void {
		while (this.bytes > this.byteBudget && this.entries.size > 1) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) return;
			this.delete(oldest);
		}
	}
}
