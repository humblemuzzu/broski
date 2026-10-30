/**
 * Keeps the catalog fresh for session files other processes write (README §5: "CC and Pi report
 * nothing live, so their adapters watch the session directories"). A directory event makes the index
 * re-scan that directory; what the index learns, from that or from a listing, is news, and each piece of
 * news becomes one catalog event, so a listing by one phone never hides a change from the others. A
 * missed watch event costs nothing lasting: the next listing re-scans, and `attach()` re-establishes a lost watcher.
 */

import { type FSWatcher, watch } from "node:fs";
import { dirname, join } from "node:path";
import type { CatalogFeed } from "../catalog-feed";
import { isDirectory } from "../is-directory";
import type { LiveOverlay } from "../ports";
import { summaryFor } from "./list";
import { isFileSystemError } from "./open-file";
import type { SessionRoot } from "./session-dir";
import type { SessionIndex } from "./session-index";

/** Events within this window of the first one are one re-scan. */
const DEBOUNCE_MS = 150;

export class SessionWatch {
	private readonly watchers = new Map<string, FSWatcher>();
	private readonly dirty = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private pending: Promise<void> = Promise.resolve();
	private live: LiveOverlay | undefined;
	private stopped = false;

	constructor(
		private readonly deps: {
			readonly index: SessionIndex;
			readonly catalog: CatalogFeed;
			readonly roots: () => SessionRoot[];
		},
	) {}

	/** The files there now are the starting point; anything after them is news, found by a watcher or a listing. */
	start(live: LiveOverlay): void {
		if (this.stopped || this.live !== undefined) return;
		this.live = live;
		this.deps.index.beginNews();
		for (const root of this.deps.roots()) {
			if (isDirectory(root.dir)) this.watchRoot(root);
		}
	}

	/**
	 * Watches every session root that exists and is not watched yet: one created after `start`, or one whose
	 * watcher was lost. What it holds may have changed with no watcher to see it, so it is re-scanned.
	 */
	attach(): void {
		if (this.stopped || this.live === undefined) return;
		for (const root of this.deps.roots()) {
			if (this.watchers.has(root.dir) || !isDirectory(root.dir)) continue;
			this.watchRoot(root);
			this.rescan(root);
		}
	}

	/** Reports what a listing learned since the last report. */
	notify(): void {
		if (this.live !== undefined) this.schedule(undefined);
	}

	stop(): void {
		this.stopped = true;
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
		this.dirty.clear();
	}

	/** Synchronously after the index's starting point, so no file can appear between them unseen. */
	private watchRoot(root: SessionRoot): void {
		try {
			const watcher = watch(root.dir, { recursive: root.nested, persistent: false }, (_event, filename) => {
				this.noteEvent(root.dir, filename);
			});
			watcher.on("error", () => this.lose(root.dir, watcher));
			this.watchers.set(root.dir, watcher);
		} catch (error) {
			if (!isFileSystemError(error)) throw error;
		}
	}

	private rescan(root: SessionRoot): void {
		for (const dir of this.deps.index.directories()) {
			if (dir === root.dir || dirname(dir) === root.dir) this.schedule(dir);
		}
	}

	private lose(root: string, watcher: FSWatcher): void {
		watcher.close();
		if (this.watchers.get(root) === watcher) this.watchers.delete(root);
	}

	/**
	 * `filename` is relative to `root`. A `.jsonl` file dirties its directory; anything else may be a new
	 * directory, whose files were possibly written before the watcher reached it.
	 */
	private noteEvent(root: string, filename: string | null): void {
		const path = filename === null ? root : join(root, filename);
		this.schedule(filename?.endsWith(".jsonl") ? dirname(path) : path);
	}

	private schedule(dir: string | undefined): void {
		if (this.stopped) return;
		if (dir !== undefined) this.dirty.add(dir);
		this.timer ??= setTimeout(() => this.flush(), DEBOUNCE_MS);
	}

	private flush(): void {
		this.timer = undefined;
		const dirs = [...this.dirty];
		this.dirty.clear();
		this.pending = this.pending.then(() =>
			this.reconcile(dirs).catch(() => {
				// The next event or listing reads these again (module comment); none is lost, none loops.
				if (!this.stopped) for (const dir of dirs) this.dirty.add(dir);
			}),
		);
	}

	private async reconcile(dirs: readonly string[]): Promise<void> {
		for (const dir of dirs) {
			if (this.stopped) return;
			await this.deps.index.refresh(dir);
		}
		await this.announce();
	}

	/** A row that could not be read now is news again, and the failure makes `flush` read its directory again. */
	private async announce(): Promise<void> {
		const live = this.live;
		if (live === undefined || this.stopped) return;
		const news = this.deps.index.takeNews();
		let failure: unknown;
		for (const head of news.updated) {
			// A hosted session's row is announced by its host, as it changes and with the time it changed.
			if (live.row(head.sessionId) !== undefined) continue;
			try {
				const summary = await summaryFor(this.deps.index, head, live);
				if (!this.stopped) this.deps.catalog.emit({ type: "session_updated", summary });
			} catch (error) {
				this.deps.index.requeue(head);
				failure ??= error;
			}
		}
		for (const sessionId of news.removed) {
			if (!this.stopped) this.deps.catalog.emit({ type: "session_removed", session: { backend: "pi", sessionId } });
		}
		if (failure !== undefined) throw failure;
	}
}
