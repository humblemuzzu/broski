import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import type { CoreLog } from "../core/ports";
import { assertNotRealHome } from "../safety/real-home-guard";

export interface JsonLinesJournalOptions<T> {
	readonly path: string;
	/** What the file keeps, for the log: "prompt journal". */
	readonly what: string;
	/** Each line is one entry of this shape; a line that is not is skipped. */
	readonly entry: z.ZodType<T>;
	/** The newest entries kept: past twice that many lines the file is rewritten with them. */
	readonly keep: number;
	readonly log: CoreLog;
}

export interface JsonLinesJournal<T> {
	/** The entries kept by earlier runs, oldest first. */
	load(): T[];
	append(entry: T): void;
}

/**
 * A journal as a JSON-lines file, `0600` in a `0700` directory: one entry per line, appended as it
 * happens. A line that does not parse is skipped and rewritten away at the next load. An I/O failure
 * is logged and leaves the in-memory state to do the job alone; after an append that failed part-way
 * the next one starts on a line of its own.
 */
export function openJsonLinesJournal<T>(options: JsonLinesJournalOptions<T>): JsonLinesJournal<T> {
	const { path, what, entry, keep, log } = options;
	assertNotRealHome(path, what);
	let lines = 0;
	let torn = false;
	const failed = (action: string, error: unknown): void => {
		log.error(`[core] the ${what} at ${path} could not be ${action}: ${String(error)}`);
	};
	const parseLine = (line: string): T[] => {
		try {
			const parsed = entry.safeParse(JSON.parse(line));
			return parsed.success ? [parsed.data] : [];
		} catch {
			return [];
		}
	};
	const compact = (entries: readonly T[]): void => {
		try {
			const temporary = `${path}.tmp`;
			writeFileSync(temporary, entries.map((kept) => `${JSON.stringify(kept)}\n`).join(""), { mode: 0o600 });
			renameSync(temporary, path);
			lines = entries.length;
		} catch (error) {
			failed("compacted", error);
		}
	};
	const read = (): { entries: T[]; lines: number } => {
		const all = readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line !== "");
		return { entries: all.flatMap(parseLine).slice(-keep), lines: all.length };
	};
	return {
		load: () => {
			let found: { entries: T[]; lines: number };
			try {
				if (!existsSync(path)) return [];
				found = read();
			} catch (error) {
				failed("read", error);
				return [];
			}
			lines = found.lines;
			if (found.entries.length !== found.lines) compact(found.entries);
			return found.entries;
		},
		append: (added) => {
			try {
				mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
				appendFileSync(path, `${torn ? "\n" : ""}${JSON.stringify(added)}\n`, { mode: 0o600 });
			} catch (error) {
				torn = true;
				failed("written", error);
				return;
			}
			torn = false;
			lines += 1;
			if (lines <= 2 * keep) return;
			try {
				compact(read().entries);
			} catch (error) {
				failed("read", error);
			}
		},
	};
}
