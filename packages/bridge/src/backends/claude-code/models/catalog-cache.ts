/** Lane C · `initialize` answers by cwd: memory, then `<stateDir>/catalog.json`; 24 h, or until invalidated (D6). */

import { readFile, stat } from "node:fs/promises";
import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { writeAtomic } from "../files/atomic-write";
import { CatalogFile, parseInitializeAnswer } from "./catalog-schema";

export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 32;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** One cwd's answer. `skills` is unknown (undefined) when a host's own `initialize` made the entry, which lists none. */
export interface CatalogEntry {
	readonly at: number;
	readonly init: SDKControlInitializeResponse;
	readonly skills: readonly string[] | undefined;
}

export interface CatalogCacheOptions {
	readonly path: string;
	/** The binary the answers came from: another binary has other models and commands, so its answers are not kept. */
	readonly cliPath: string;
	readonly now: () => number;
}

/** Every call runs after the one before, so a read never sees half of a drop, and the file is written whole each time. */
export class CatalogCache {
	private readonly entries = new Map<string, CatalogEntry>();
	private loaded = false;
	private tail: Promise<unknown> = Promise.resolve();

	constructor(private readonly options: CatalogCacheOptions) {}

	get(cwd: string): Promise<CatalogEntry | undefined> {
		return this.serial(async () => {
			await this.load();
			const entry = this.entries.get(cwd);
			if (entry && this.fresh(entry)) return entry;
			this.entries.delete(cwd);
			return undefined;
		});
	}

	set(cwd: string, entry: CatalogEntry): Promise<void> {
		return this.serial(async () => {
			await this.load();
			this.entries.delete(cwd);
			this.entries.set(cwd, entry);
			this.evictOldest();
			await this.save();
		});
	}

	/** Replaces the answer of `cwd` and keeps the skills already known for it (a host's answer lists none). */
	refresh(cwd: string, init: SDKControlInitializeResponse): Promise<void> {
		return this.serial(async () => {
			await this.load();
			const known = this.entries.get(cwd);
			const skills = known && this.fresh(known) ? known.skills : undefined;
			this.entries.delete(cwd);
			this.entries.set(cwd, { at: this.options.now(), init, skills });
			this.evictOldest();
			await this.save();
		});
	}

	drop(cwd?: string): Promise<void> {
		return this.serial(async () => {
			await this.load();
			const had = cwd === undefined ? this.entries.size > 0 : this.entries.has(cwd);
			if (cwd === undefined) this.entries.clear();
			else this.entries.delete(cwd);
			if (had) await this.save();
		});
	}

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const result = this.tail.then(work);
		this.tail = result.catch(() => undefined);
		return result;
	}

	private fresh(entry: CatalogEntry): boolean {
		return this.options.now() - entry.at < CATALOG_MAX_AGE_MS;
	}

	private evictOldest(): void {
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next();
			if (oldest.done) return;
			this.entries.delete(oldest.value);
		}
	}

	private async load(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		try {
			if ((await stat(this.options.path)).size > MAX_FILE_BYTES) return;
			const file = CatalogFile.safeParse(JSON.parse(await readFile(this.options.path, "utf8")));
			if (!file.success || file.data.cliPath !== this.options.cliPath) return;
			for (const { cwd, at, skills, init } of file.data.entries) {
				const answer = parseInitializeAnswer(init);
				if (answer) this.entries.set(cwd, { at, init: answer, skills });
			}
			this.evictOldest();
		} catch {
			// A missing or unreadable file is an empty cache.
		}
	}

	private async save(): Promise<void> {
		const entries = [...this.entries].map(([cwd, { at, init, skills }]) => ({
			cwd,
			at,
			init,
			...(skills && { skills }),
		}));
		const text = JSON.stringify({
			version: 1,
			cliPath: this.options.cliPath,
			entries,
		});
		try {
			await writeAtomic(this.options.path, text, { mode: 0o600, dirMode: 0o700 });
		} catch {
			// The cache is memory-only until the directory is writable again.
		}
	}
}
