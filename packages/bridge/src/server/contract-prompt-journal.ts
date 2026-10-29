import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ClientRequestId, PromptAccepted, SessionRef } from "../contract";
import type { CoreLog, JournalEntry, PromptJournal } from "../core/ports";
import { PROMPT_MEMORY } from "../core/prompt-ledger";
import { assertNotRealHome } from "../safety/real-home-guard";

const JournalLine = z.strictObject({ session: SessionRef, clientRequestId: ClientRequestId, result: PromptAccepted });

/**
 * The core's prompt journal as a JSON-lines file: one accepted prompt per line, appended as it is
 * accepted. It keeps the newest `PROMPT_MEMORY` entries: past twice that many lines the file is
 * rewritten with those. A line that does not parse is skipped. An I/O failure is logged and leaves
 * the in-memory ledger to do the job alone.
 */
export function openPromptJournal(path: string, log: CoreLog): PromptJournal {
	assertNotRealHome(path, "prompt journal");
	let lines = 0;
	/** A failed append may have left part of a line; the next one starts on a line of its own. */
	let torn = false;
	const failed = (what: string, error: unknown): void => {
		log.error(`[core] the prompt journal at ${path} could not be ${what}: ${String(error)}`);
	};
	const compact = (entries: readonly JournalEntry[]): void => {
		try {
			const temporary = `${path}.tmp`;
			writeFileSync(temporary, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { mode: 0o600 });
			renameSync(temporary, path);
			lines = entries.length;
		} catch (error) {
			failed("compacted", error);
		}
	};
	const read = (): { entries: JournalEntry[]; lines: number } => {
		const all = readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line !== "");
		return { entries: all.flatMap(parseLine).slice(-PROMPT_MEMORY), lines: all.length };
	};
	return {
		load: () => {
			let found: { entries: JournalEntry[]; lines: number };
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
		append: (entry) => {
			try {
				mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
				appendFileSync(path, `${torn ? "\n" : ""}${JSON.stringify(entry)}\n`, { mode: 0o600 });
			} catch (error) {
				torn = true;
				failed("written", error);
				return;
			}
			torn = false;
			lines += 1;
			if (lines <= 2 * PROMPT_MEMORY) return;
			try {
				compact(read().entries);
			} catch (error) {
				failed("read", error);
			}
		},
	};
}

function parseLine(line: string): JournalEntry[] {
	try {
		const parsed = JournalLine.safeParse(JSON.parse(line));
		return parsed.success ? [parsed.data] : [];
	} catch {
		return [];
	}
}
