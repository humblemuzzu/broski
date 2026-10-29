import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReplacementRecord } from "../core/ports";
import { REPLACEMENT_MEMORY } from "../core/replacements";
import { RealHomeWriteError, setRealHomeForTesting } from "../safety/real-home-guard";
import { openReplacementJournal } from "../server/contract-replacement-journal";
import { RecordingLog } from "./helpers/core-rig";

const roots: string[] = [];

function journalPath(): string {
	const root = mkdtempSync(join(tmpdir(), "broski-replacement-journal-"));
	roots.push(root);
	return join(root, "core", "replacements.jsonl");
}

function record(index: number): ReplacementRecord {
	return {
		epoch: `epoch-${index}`,
		next: { backend: "claude-code", sessionId: `s${index}` },
		nextEpoch: `next-${index}`,
		at: 1_700_000_000_000 + index,
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the replacement journal file", () => {
	test("keeps what was appended for the next start, and starts empty without a file", () => {
		const path = journalPath();
		const log = new RecordingLog();
		expect(openReplacementJournal(path, log).load()).toEqual([]);
		const journal = openReplacementJournal(path, log);
		journal.append(record(1));
		journal.append(record(2));
		expect(openReplacementJournal(path, log).load()).toEqual([record(1), record(2)]);
		expect(log.errors).toEqual([]);
	});

	test("skips a line that is not a record, and rewrites the file without it", () => {
		const path = journalPath();
		openReplacementJournal(path, new RecordingLog()).append(record(1));
		appendFileSync(path, 'not json\n{"epoch":"e","next":{"backend":"pi","sessionId":"s"}}\n');
		expect(openReplacementJournal(path, new RecordingLog()).load()).toEqual([record(1)]);
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(record(1))}\n`);
	});

	test("keeps the newest records once the file has grown to twice its memory", () => {
		const path = journalPath();
		const journal = openReplacementJournal(path, new RecordingLog());
		journal.load();
		const all = Array.from({ length: 2 * REPLACEMENT_MEMORY + 1 }, (_, index) => record(index));
		for (const item of all) journal.append(item);
		expect(openReplacementJournal(path, new RecordingLog()).load()).toEqual(all.slice(-REPLACEMENT_MEMORY));
	});

	test("under test isolation, a journal inside the real home is refused before anything is written", () => {
		const home = mkdtempSync(join(tmpdir(), "broski-real-home-"));
		roots.push(home);
		setRealHomeForTesting(home);
		try {
			expect(() =>
				openReplacementJournal(join(home, ".broski", "core", "replacements.jsonl"), new RecordingLog()),
			).toThrow(RealHomeWriteError);
		} finally {
			setRealHomeForTesting(null);
		}
	});
});
