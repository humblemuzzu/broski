import { type FSWatcher, watch as fsWatch } from "node:fs";
import { type ManagedInterval, nodeInterval } from "../timers";

export type CcFsWatchKind = "skills" | "plugins" | "hooks" | "commands" | "mcp";

export type CcFsChange = {
	kind: CcFsWatchKind;
	dir: string;
	cwd?: string;
	file?: string;
};

export type CcFsWatcherDeps = {
	onChange: (change: CcFsChange) => void;
	/** Watchers kept alive at once; the least recently used is closed past the cap. */
	maxWatchers?: number;
	/** Watchers for directories not requested again within this window are closed. */
	idleMs?: number;
	debounceMs?: number;
	pruneIntervalMs?: number;
	now?: () => number;
	interval?: ManagedInterval;
	watchDir?: (dir: string, options: { persistent: boolean; recursive: boolean }) => FSWatcher;
};

type WatcherEntry = {
	watcher: FSWatcher;
	kind: CcFsWatchKind;
	cwd?: string;
	lastAccess: number;
	debounce: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_MAX_WATCHERS = 32;
const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 1000;

export class CcFsWatcherRegistry {
	private readonly deps: CcFsWatcherDeps;
	private readonly entries = new Map<string, WatcherEntry>();
	private readonly maxWatchers: number;
	private readonly idleMs: number;
	private readonly debounceMs: number;
	private readonly pruneIntervalMs: number;
	private readonly now: () => number;
	private readonly interval: ManagedInterval;
	private stopTimer: (() => void) | null = null;

	constructor(deps: CcFsWatcherDeps) {
		this.deps = deps;
		this.maxWatchers = deps.maxWatchers ?? DEFAULT_MAX_WATCHERS;
		this.idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
		this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.pruneIntervalMs = deps.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
		this.now = deps.now ?? Date.now;
		this.interval = deps.interval ?? nodeInterval;
	}

	get size(): number {
		return this.entries.size;
	}

	has(dir: string): boolean {
		return this.entries.has(dir);
	}

	ensure(dir: string, kind: CcFsWatchKind, cwd?: string, recursive = true): void {
		if (!dir) return;

		const existing = this.entries.get(dir);
		if (existing) {
			existing.lastAccess = this.now();
			return;
		}

		this.startPruneTimer();
		this.evictOverCap();

		try {
			const watcher = (this.deps.watchDir ?? fsWatch)(dir, { persistent: false, recursive });
			watcher.on("change", (_eventType, filename) => this.notify(dir, filename));
			this.entries.set(dir, {
				watcher,
				kind,
				cwd,
				lastAccess: this.now(),
				debounce: null,
			});
		} catch {
			// Ignore watch failures (dir missing or unsupported)
		}
	}

	prune(): number {
		const cutoff = this.now() - this.idleMs;
		let closed = 0;
		for (const [dir, entry] of [...this.entries.entries()]) {
			if (entry.lastAccess > cutoff) continue;
			this.close(dir, entry);
			closed++;
		}
		if (this.entries.size === 0) this.stopPruneTimer();
		return closed;
	}

	closeAll(): void {
		this.stopPruneTimer();
		for (const [dir, entry] of [...this.entries.entries()]) {
			this.close(dir, entry);
		}
	}

	private notify(dir: string, filename: string | Buffer | null): void {
		const entry = this.entries.get(dir);
		if (!entry) return;

		if (entry.debounce) clearTimeout(entry.debounce);
		entry.debounce = setTimeout(() => {
			const current = this.entries.get(dir);
			if (current) current.debounce = null;
			this.deps.onChange({
				kind: entry.kind,
				dir,
				...(entry.cwd ? { cwd: entry.cwd } : {}),
				...(filename ? { file: String(filename) } : {}),
			});
		}, this.debounceMs);
	}

	private evictOverCap(): void {
		while (this.entries.size >= this.maxWatchers) {
			let oldestDir: string | null = null;
			let oldestAccess = Number.POSITIVE_INFINITY;
			for (const [dir, entry] of this.entries.entries()) {
				if (entry.lastAccess < oldestAccess) {
					oldestAccess = entry.lastAccess;
					oldestDir = dir;
				}
			}
			if (!oldestDir) return;
			const entry = this.entries.get(oldestDir);
			if (!entry) return;
			this.close(oldestDir, entry);
		}
	}

	private close(dir: string, entry: WatcherEntry): void {
		this.entries.delete(dir);
		if (entry.debounce) clearTimeout(entry.debounce);
		try {
			entry.watcher.close();
		} catch {
			// Already closed.
		}
	}

	private startPruneTimer(): void {
		if (this.stopTimer) return;
		this.stopTimer = this.interval.start(() => {
			this.prune();
		}, this.pruneIntervalMs);
	}

	private stopPruneTimer(): void {
		const stop = this.stopTimer;
		this.stopTimer = null;
		stop?.();
	}
}
