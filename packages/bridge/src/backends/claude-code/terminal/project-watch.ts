/**
 * One watcher per project directory under `configRoot()/projects/`, shared by every watch-only session in it (research
 * 04 §7 rec. 3). `fs.watch` says a transcript changed; a slow `stat` sweep over the tracked files catches what it misses.
 */

import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Clock } from "../ports/time";

export const SWEEP_MS = 250;

export class ProjectWatch {
	private watcher: FSWatcher | undefined;
	private cancelSweep: (() => void) | undefined;
	private stopped = true;
	private readonly tracked = new Map<string, string>();

	constructor(
		readonly projectDir: string,
		private readonly changed: (path: string) => void,
		private readonly clock: Clock,
	) {}

	get size(): number {
		return this.tracked.size;
	}

	/** Starts when the first file is tracked. */
	track(path: string): void {
		if (dirname(path) !== this.projectDir) return;
		this.tracked.set(path, "");
		if (this.stopped) this.start();
	}

	/** Stops when the last file is let go. */
	untrack(path: string): void {
		this.tracked.delete(path);
		if (this.tracked.size === 0) this.stop();
	}

	stop(): void {
		this.stopped = true;
		try {
			this.watcher?.close();
		} catch {
			// A watcher whose directory is gone may refuse to close; there is nothing left to release.
		}
		this.watcher = undefined;
		this.cancelSweep?.();
		this.cancelSweep = undefined;
	}

	private start(): void {
		this.stopped = false;
		try {
			this.watcher = watch(this.projectDir, { persistent: false }, (_event, name) => this.onName(name));
			this.watcher.on("error", () => this.watcher?.close());
		} catch {
			this.watcher = undefined;
		}
		this.armSweep();
	}

	private onName(name: string | Buffer | null): void {
		if (name === null) return;
		const path = join(this.projectDir, basename(name.toString()));
		if (this.tracked.has(path)) this.notify(path);
	}

	private notify(path: string): void {
		try {
			this.changed(path);
		} catch {
			// The listener's failure is not the watcher's.
		}
	}

	private armSweep(): void {
		this.cancelSweep = this.clock.after(SWEEP_MS, () => {
			void this.sweep().finally(() => {
				if (!this.stopped) this.armSweep();
			});
		});
	}

	private async sweep(): Promise<void> {
		for (const [path, before] of [...this.tracked]) {
			const now = await signature(path);
			if (this.stopped) return;
			if (now === before) continue;
			if (this.tracked.has(path)) this.tracked.set(path, now);
			if (before !== "") this.notify(path);
		}
	}
}

async function signature(path: string): Promise<string> {
	try {
		const info = await stat(path);
		return `${info.size}:${info.mtimeMs}:${info.ino}`;
	} catch {
		return "gone";
	}
}
