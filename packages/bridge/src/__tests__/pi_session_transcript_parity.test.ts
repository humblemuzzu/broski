/**
 * Parity of the bounded Pi transcript reader against the pre-optimisation whole-file read.
 *
 * The synthetic cases cover the tree shapes the bounded reader must not get wrong: branches that
 * leave the leaf path, compactions that cut the path, context edits, malformed lines, legacy
 * session versions and entries whose fields are not in the head of the line. The real-session block
 * is read-only and skips itself when this machine has no `~/.pi/agent/sessions`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { legacyReadPiSessionMessages } from "../../bench/lib/pi-session-oracle";
import {
	appendChain,
	assistant,
	branchSummary,
	chain,
	compaction,
	contextEdit,
	custom,
	type Entry,
	header,
	nowMs,
	stamp,
	system,
	usage,
	user,
	writeSession as writeSessionFile,
} from "../../bench/lib/pi-synthetic-sessions";
import { indexPiSessionFile } from "../connectors/pi/pi-session-index";
import { readPiSessionTranscript } from "../connectors/pi/pi-session-transcript";
import { PiSessionCycleError, piSessionPath } from "../connectors/pi/pi-session-window";

const LIMITS = [undefined, 1, 2, 3, 5, 8, 25, 1000];
const SMALL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const REAL_FILE_COUNT = 32;
const SHAPE_SCAN_LIMIT = 120;

let root = "";

async function writeSession(name: string, entries: Entry[]): Promise<string> {
	return writeSessionFile(root, name, entries);
}

async function expectParity(path: string, limits: Array<number | undefined> = LIMITS): Promise<void> {
	for (const limit of limits) {
		const actual = await readPiSessionTranscript(path, limit);
		const expected = await legacyReadPiSessionMessages(path, limit);
		expect(actual, `${path} limit=${limit}`).toEqual(expected);
	}
}

describe("Pi session transcript parity", () => {
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "broski-pi-transcript-"));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("matches a linear session at every limit", async () => {
		await expectParity(await writeSession("linear.jsonl", [header(), ...chain(24)]));
	});

	it("matches when the tail of the file is not on the leaf path", async () => {
		const entries: Entry[] = [header()];
		const base = chain(12);
		entries.push(...base);
		// A side branch written after the main chain, then the main chain resumed: the last lines of
		// the file are on the leaf path again, and the side branch sits in between.
		const sideTip = appendChain(entries, 6, "side", base[8]?.id as string);
		const mainTip = appendChain(entries, 2, "tail", base[11]?.id as string);
		entries.push(branchSummary("bs1", mainTip, sideTip));

		await expectParity(await writeSession("branched.jsonl", entries));
	});

	it("matches when the leaf is a dead-end off the main chain", async () => {
		const entries: Entry[] = [header()];
		const base = chain(14);
		entries.push(...base);
		const sideTip = appendChain(entries, 3, "side", base[5]?.id as string);
		entries.push(branchSummary("bs1", sideTip, base[13]?.id as string));

		await expectParity(await writeSession("dead-end-leaf.jsonl", entries));
	});

	it("matches when a compaction cuts the path near the tail", async () => {
		const base = chain(30);
		const keptId = base[24]?.id as string;
		const compactionEntry = compaction("c1", base[29]?.id as string, keptId);
		const tail: Entry[] = [...base, compactionEntry];
		appendChain(tail, 6, "post", "c1");
		await expectParity(await writeSession("compaction-tail.jsonl", [header(), ...tail]));

		const retainNone = compaction("c2", base[29]?.id as string, "c2");
		await expectParity(await writeSession("compaction-retain-none.jsonl", [header(), ...base, retainNone]));

		const withSystem: Entry[] = [header(), ...base, system("s1", base[24]?.id as string)];
		const systemCompaction = compaction("c3", "s1", keptId, {
			systemMessage: { role: "system", content: "checkpoint", timestamp: nowMs() },
		});
		withSystem.push(systemCompaction);
		appendChain(withSystem, 4, "sys-post", "c3");
		await expectParity(await writeSession("compaction-system-message.jsonl", withSystem));
	});

	it("matches when two compactions sit on the path", async () => {
		const entries: Entry[] = [header()];
		const base = chain(28);
		entries.push(...base, compaction("c-early", base[10]?.id as string, base[6]?.id as string));
		const midTip = appendChain(entries, 12, "mid", "c-early");
		entries.push(compaction("c-late", midTip, "mid8"));
		appendChain(entries, 4, "end", "c-late");
		await expectParity(await writeSession("two-compactions.jsonl", entries));
	});

	it("matches with context edits inside and outside the window", async () => {
		const entries: Entry[] = [header()];
		const base = chain(24);
		entries.push(...base);
		entries.push(contextEdit("e1", base[2]?.id as string, base[2]?.id as string, { content: "edited early" }));
		entries.push(contextEdit("e2", base[22]?.id as string, base[22]?.id as string, { content: "edited late" }));
		const postTip = appendChain(entries, 3, "post", "e2");
		entries.push(contextEdit("e3", postTip, "post0", null));
		appendChain(entries, 2, "final", "e3");
		await expectParity(await writeSession("context-edit.jsonl", entries));
	});

	it("matches with a context edit whose target is outside the window", async () => {
		const entries: Entry[] = [header()];
		const base = chain(20);
		entries.push(...base);
		entries.push(contextEdit("e1", base[3]?.id as string, base[3]?.id as string, { content: "early edit" }));
		appendChain(entries, 4, "post", "e1");
		await expectParity(await writeSession("context-edit-outside.jsonl", entries));
	});

	it("matches when an edit is written before the entry it rewrites", async () => {
		const base = chain(6);
		// The edit sits early on the path and names a later entry; a tail window cannot see the
		// edit, so the read must fall back to the whole-file walk rather than return unedited text.
		const edit = contextEdit("e-early", base[5]?.id as string, "post9", { content: "rewritten later entry" });
		const tail = chain(14, "post").map((entry, index) => ({
			...entry,
			parentId: index === 0 ? "e-early" : `post${index - 1}`,
		}));
		await expectParity(await writeSession("context-edit-out-of-order.jsonl", [header(), ...base, edit, ...tail]));
	});

	it("matches with custom, usage, label and branch-summary entries interleaved", async () => {
		const entries: Entry[] = [header()];
		let parentId: string | null = null;
		for (let i = 0; i < 18; i++) {
			const id = `n${i}`;
			if (i % 6 === 5) entries.push(usage(id, parentId));
			else if (i % 6 === 4) entries.push(custom(id, parentId));
			else if (i % 6 === 3) entries.push(i % 2 === 0 ? branchSummary(id, parentId, "gone") : custom(id, parentId));
			else entries.push(i % 2 === 0 ? user(id, parentId, `user ${i}`) : assistant(id, parentId, `assistant ${i}`));
			parentId = id;
		}
		await expectParity(await writeSession("mixed-entries.jsonl", entries));
	});

	it("matches with blank, malformed and truncated lines", async () => {
		const base = chain(14);
		const noisy: Entry[] = [header(), ...base];
		const noisyPath = join(root, "noisy.jsonl");
		const lines = noisy.map((entry) => JSON.stringify(entry));
		lines.splice(6, 0, "", "   ", "not json");
		lines.push('{"type":"message","id":"trunc"');
		await writeFile(noisyPath, `${lines.join("\n")}\n`);
		await expectParity(noisyPath);

		const crlfPath = join(root, "crlf.jsonl");
		await writeFile(
			crlfPath,
			[header(), ...chain(6)]
				.filter(Boolean)
				.map((entry) => JSON.stringify(entry))
				.join("\r\n"),
		);
		await expectParity(crlfPath);

		const trailingPath = join(root, "no-trailing-newline.jsonl");
		await writeFile(
			trailingPath,
			[header(), ...chain(7)]
				.filter(Boolean)
				.map((entry) => JSON.stringify(entry))
				.join("\n"),
		);
		await expectParity(trailingPath);
	});

	it("matches when a line is malformed in the middle of the path", async () => {
		const base = chain(16);
		const path = join(root, "broken-middle.jsonl");
		const lines = [header(), ...base].map((entry) => JSON.stringify(entry));
		lines[9] = '{"type":"message","id":"broken","parentId":"m6",';
		await writeFile(path, `${lines.join("\n")}\n`);
		await expectParity(path);
	});

	it("reports a repeated id instead of walking its looping parent chain", async () => {
		// A repeated id makes the parent chain loop, which never returns in `buildSessionContext`,
		// so there is no reference output to compare against.
		const base = chain(12);
		const duplicate: Entry = { ...(base[10] as Entry), id: "m8", message: { role: "user", content: "dup" } };
		const path = await writeSession("duplicate-ids.jsonl", [header(), ...base, duplicate]);
		await expect(readPiSessionTranscript(path, 5)).rejects.toThrow(PiSessionCycleError);
	});

	it("matches when a parent id does not exist", async () => {
		const base = chain(10);
		const orphan = { ...user("orphan", "missing-parent", "orphan text") };
		await expectParity(await writeSession("orphan.jsonl", [header(), ...base, orphan]));
	});

	it("matches legacy session versions and missing headers", async () => {
		const v2 = [header(2), ...chain(8)];
		await expectParity(await writeSession("v2.jsonl", v2));

		const v1 = chain(6).map((entry) => {
			const { id, parentId, ...rest } = entry as Entry & { id?: string; parentId?: string | null };
			return rest as Entry;
		});
		await expectParity(await writeSession("v1.jsonl", [header(1), ...v1]));

		await expectParity(await writeSession("no-header.jsonl", chain(5)));
	});

	it("matches when an entry's fields are not in the head of the line", async () => {
		const base = chain(12);
		const padded: Entry = {
			filler: "x".repeat(200_000),
			type: "message",
			message: { role: "user", content: "late fields", timestamp: nowMs() },
			id: "late1",
			parentId: base[11]?.id as string,
			timestamp: stamp(),
		};
		const entries: Entry[] = [header(), ...base, padded];
		await expectParity(await writeSession("late-fields.jsonl", entries));
	});

	it("matches on entries with multi-megabyte payloads", async () => {
		const entries: Entry[] = [header()];
		const base = chain(10);
		entries.push(...base);
		entries.push({
			type: "message",
			id: "big1",
			parentId: base[9]?.id as string,
			timestamp: stamp(),
			message: {
				role: "toolResult",
				toolCallId: "call-big",
				toolName: "read",
				content: [{ type: "text", text: "y".repeat(4 * 1024 * 1024) }],
				isError: false,
				timestamp: nowMs(),
			},
		});
		appendChain(entries, 3, "big-after", "big1");
		await expectParity(await writeSession("big-line.jsonl", entries));
	});

	it("matches on an empty file, a header-only file and a missing file", async () => {
		const empty = join(root, "empty.jsonl");
		await writeFile(empty, "");
		await expectParity(empty);

		await expectParity(await writeSession("header-only.jsonl", [header()]));
		await expect(readPiSessionTranscript(join(root, "missing.jsonl"), 5)).rejects.toThrow();
	});

	it("indexes entries with byte ranges that round-trip", async () => {
		const path = await writeSession("index.jsonl", [header(), ...chain(9)]);
		const index = await indexPiSessionFile(path);
		expect(index.headerVersion).toBe(3);
		expect(index.unreliable).toBe(false);
		expect(index.entries.map((entry) => entry.id)).toEqual(chain(9).map((entry) => entry.id as string));
		const size = (await stat(path)).size;
		for (const [position, entry] of index.entries.entries()) {
			expect(entry.offset).toBeGreaterThan(0);
			expect(entry.offset + entry.length).toBeLessThanOrEqual(size);
			if (position > 0) {
				expect(entry.parentId).toBe(index.entries[position - 1]?.id ?? null);
			}
		}
		expect(piSessionPath(index)).toEqual(index.entries.map((_, position) => position));
	});

	it("skips off-path entries when walking the tree", async () => {
		const base = chain(6);
		const entries: Entry[] = [
			header(),
			...base,
			...chain(4, "side").map((entry, index) => ({
				...entry,
				parentId: index === 0 ? (base[2]?.id as string) : `side${index - 1}`,
			})),
			...chain(2, "main").map((entry, index) => ({
				...entry,
				parentId: index === 0 ? (base[5]?.id as string) : "main0",
			})),
		];
		const path = await writeSession("off-path.jsonl", entries);
		const index = await indexPiSessionFile(path);
		const onPath = (piSessionPath(index) ?? []).map((position) => index.entries[position]?.id);
		expect(onPath).toEqual([...chain(6), ...chain(2, "main")].map((entry) => entry.id as string));
	});
});

type RealSession = { path: string; size: number };

async function collectRealSessions(): Promise<RealSession[]> {
	const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
	const found: RealSession[] = [];
	let projectDirs: string[] = [];
	try {
		projectDirs = await readdir(sessionsRoot);
	} catch {
		return [];
	}
	for (const projectDir of projectDirs) {
		let names: string[] = [];
		try {
			names = await readdir(join(sessionsRoot, projectDir));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".jsonl")) continue;
			const path = join(sessionsRoot, projectDir, name);
			try {
				found.push({ path, size: (await stat(path)).size });
			} catch {}
		}
	}
	return found;
}

describe("Pi session transcript parity on real sessions", () => {
	it("matches the whole-file read on this machine's smaller sessions", async () => {
		const sessions = await collectRealSessions();
		if (sessions.length === 0) {
			console.warn("[pi-session-transcript] no ~/.pi/agent/sessions on this machine — real-data parity skipped");
			return;
		}

		const selected = await selectRealSessions(sessions, SMALL_FILE_LIMIT_BYTES, REAL_FILE_COUNT);
		for (const session of selected) {
			await expectParity(session.path, LIMITS);
		}

		const megabytes = (selected[0]?.size ?? 0) / 1024 / 1024;
		console.log(
			`[pi-session-transcript] parity checked ${selected.length} real sessions, largest ${megabytes.toFixed(1)} MB`,
		);
	}, 300_000);

	// A whole-file read of a 400 MB session peaks near 2 GB, so the largest sessions are compared
	// in their own process by the `pi-transcript-parity` bench scenario instead of here:
	//   bun bench/run.ts --filter=pi-transcript-parity --cap-rss-mb=3584
});

/** Takes the largest small sessions first, then ones whose tree shape exercises the window. */
async function selectRealSessions(sessions: RealSession[], maxBytes: number, count: number): Promise<RealSession[]> {
	const small = sessions.filter((session) => session.size > 0 && session.size <= maxBytes);
	small.sort((a, b) => b.size - a.size);

	const selected = small.slice(0, 5);
	const shaped: RealSession[] = [];
	const plain: RealSession[] = [];
	let scanned = 0;

	for (const session of small.slice(5)) {
		if (selected.length + shaped.length + plain.length >= count || scanned >= SHAPE_SCAN_LIMIT) break;
		scanned++;
		const index = await indexPiSessionFile(session.path);
		const path = piSessionPath(index) ?? [];
		const hasCompaction = path.some((position) => index.entries[position]?.type === "compaction");
		const hasOffPath = path.length < index.entries.length;
		if (hasCompaction || hasOffPath) shaped.push(session);
		else plain.push(session);
	}

	return [...selected, ...shaped, ...plain].slice(0, count).sort((a, b) => b.size - a.size);
}
