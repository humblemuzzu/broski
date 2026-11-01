/**
 * Watching the folders where commands, skills, agents and output styles live, so a file changed on the Mac (by hand,
 * by a terminal `claude`, by git) reaches the phone as `catalog_invalidated` (parity with the old file watchers).
 * The user's folders are always watched; a project's from `track(cwd)`, up to `MAX_PROJECTS`, the oldest let go first.
 */

import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import type { CatalogueAccess } from "../ports";

const FOLDERS = ["commands", "skills", "agents", "output-styles"] as const;
const MAX_PROJECTS = 16;

export interface ConfigWatchDeps {
	readonly configRoot: string;
	readonly catalogue: Pick<CatalogueAccess, "invalidate">;
	readonly debounceMs?: number;
}

export interface ConfigWatch {
	/** Starts watching the user's folders. Safe to call twice. */
	start(): void;
	/** Starts watching `<cwd>/.claude`; already watched, it only becomes the newest. */
	track(cwd: string): void;
	dispose(): void;
}

class Anchor {
	private readonly watchers = new Map<string, FSWatcher>();
	private closed = false;

	constructor(
		private readonly root: string,
		private readonly changed: () => void,
	) {
		this.refresh();
	}

	/** Watches `root` for the folders appearing, and each folder that exists for its files changing; opens what is missing. */
	refresh(): void {
		this.open(this.root, false, (name) => {
			if (name !== null && (FOLDERS as readonly string[]).includes(name)) {
				this.refresh();
				this.changed();
			}
		});
		for (const folder of FOLDERS) this.open(join(this.root, folder), true, () => this.changed());
	}

	private open(path: string, recursive: boolean, on: (name: string | null) => void): void {
		if (this.closed || this.watchers.has(path)) return;
		try {
			const watcher = watch(path, { recursive }, (_event, name) => on(name));
			watcher.on("error", () => this.drop(path));
			this.watchers.set(path, watcher);
		} catch {
			// Not there yet: `refresh` opens it once it appears.
		}
	}

	private drop(path: string): void {
		this.watchers.get(path)?.close();
		this.watchers.delete(path);
	}

	close(): void {
		this.closed = true;
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
	}
}

export function createConfigWatch(deps: ConfigWatchDeps): ConfigWatch {
	const debounceMs = deps.debounceMs ?? 300;
	const projects = new Map<string, Anchor>();
	let user: Anchor | undefined;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	const fire = (key: string, cwd: string | undefined): void => {
		clearTimeout(timers.get(key));
		const timer = setTimeout(() => {
			timers.delete(key);
			deps.catalogue.invalidate(cwd);
		}, debounceMs);
		timer.unref?.();
		timers.set(key, timer);
	};

	return {
		start: () => {
			if (user === undefined) user = new Anchor(deps.configRoot, () => fire("", undefined));
			else user.refresh();
		},
		track: (cwd) => {
			const known = projects.get(cwd);
			if (known) {
				projects.delete(cwd);
				projects.set(cwd, known);
				known.refresh();
				return;
			}
			projects.set(cwd, new Anchor(join(cwd, ".claude"), () => fire(cwd, cwd)));
			for (const [oldest, anchor] of projects) {
				if (projects.size <= MAX_PROJECTS) break;
				anchor.close();
				projects.delete(oldest);
			}
		},
		dispose: () => {
			user?.close();
			user = undefined;
			for (const anchor of projects.values()) anchor.close();
			projects.clear();
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		},
	};
}
