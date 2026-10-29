import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { JournalEntry } from "../core/ports";
import { PROMPT_MEMORY } from "../core/prompt-ledger";
import { RealHomeWriteError, setRealHomeForTesting } from "../safety/real-home-guard";
import { openPromptJournal } from "../server/contract-prompt-journal";
import { RecordingLog } from "./helpers/core-rig";

const roots: string[] = [];

function journalPath(): string {
	const root = mkdtempSync(join(tmpdir(), "broski-prompt-journal-"));
	roots.push(root);
	return join(root, "core", "prompts.jsonl");
}

function entry(index: number): JournalEntry {
	return {
		session: { backend: "codex", sessionId: `s${index}` },
		clientRequestId: crypto.randomUUID(),
		result: { status: "accepted", disposition: "started" },
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the prompt journal file", () => {
	test("keeps what was appended for the next start, and starts empty without a file", () => {
		const path = journalPath();
		const log = new RecordingLog();
		expect(openPromptJournal(path, log).load()).toEqual([]);
		const written = [entry(1), entry(2)];
		const journal = openPromptJournal(path, log);
		for (const item of written) journal.append(item);
		expect(openPromptJournal(path, log).load()).toEqual(written);
		expect(log.errors).toEqual([]);
	});

	test("skips lines that do not parse and rewrites the file without them", () => {
		const path = journalPath();
		const log = new RecordingLog();
		const kept = entry(1);
		openPromptJournal(path, log).append(kept);
		appendFileSync(path, 'not json\n{"session":1}\n');
		expect(openPromptJournal(path, log).load()).toEqual([kept]);
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(kept)}\n`);
	});

	test("keeps only the newest entries the ledger remembers", () => {
		const path = journalPath();
		const log = new RecordingLog();
		const journal = openPromptJournal(path, log);
		journal.load();
		const all = Array.from({ length: 2 * PROMPT_MEMORY + 1 }, (_, index) => entry(index));
		for (const item of all) journal.append(item);
		const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
		expect(lines).toHaveLength(PROMPT_MEMORY);
		expect(openPromptJournal(path, log).load()).toEqual(all.slice(-PROMPT_MEMORY));
	});

	test("only its owner can read it, whether appended to or rewritten", () => {
		const path = journalPath();
		const log = new RecordingLog();
		openPromptJournal(path, log).append(entry(1));
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
		appendFileSync(path, "not json\n");
		chmodSync(path, 0o644);
		openPromptJournal(path, log).load();
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(readFileSync(path, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
	});

	test("an append that failed part-way does not take the next entry with it", () => {
		const path = journalPath();
		const log = new RecordingLog();
		const journal = openPromptJournal(path, log);
		const [first, lost, next] = [entry(1), entry(2), entry(3)];
		journal.append(first);
		chmodSync(path, 0o400);
		journal.append(lost);
		chmodSync(path, 0o600);
		appendFileSync(path, JSON.stringify(lost).slice(0, 20));
		journal.append(next);
		expect(openPromptJournal(path, log).load()).toEqual([first, next]);
		expect(log.errors.filter((line) => line.includes("could not be written"))).toHaveLength(1);
	});

	test("under test isolation, a journal inside the real home is refused before anything is written", () => {
		const home = mkdtempSync(join(tmpdir(), "broski-real-home-"));
		roots.push(home);
		setRealHomeForTesting(home);
		try {
			expect(() => openPromptJournal(join(home, ".broski", "core", "prompts.jsonl"), new RecordingLog())).toThrow(
				RealHomeWriteError,
			);
		} finally {
			setRealHomeForTesting(null);
		}
	});

	test("a journal it cannot write is logged, and appending goes on without it", () => {
		const path = journalPath();
		writeFileSync(dirname(path), "a file where the directory belongs");
		const log = new RecordingLog();
		const journal = openPromptJournal(path, log);
		expect(journal.load()).toEqual([]);
		expect(() => journal.append(entry(1))).not.toThrow();
		expect(log.errors).toHaveLength(1);
		expect(log.errors[0]).toContain("could not be written");
	});
});
