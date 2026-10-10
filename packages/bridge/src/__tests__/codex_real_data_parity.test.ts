/**
 * Parity of the fast Codex readers against the whole-file readers, on the real rollout tree.
 *
 * Opt-in because it reads ~/.codex (which no test may touch by default) and pulls the largest
 * rollouts into memory:
 *
 *   CODEX_PARITY_REAL=1 bun test src/__tests__/codex_real_data_parity.test.ts
 *
 * Everything here is read-only: the SQLite index is opened with `{ readonly: true }` and rollout
 * files are only ever read.
 */

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { statSync } from "node:fs";
import { listProjectsFromFs } from "../connectors/codex/cx-projects";
import { PREVIEW_HEAD_WINDOW_BYTES, readRolloutHeadWithPreview } from "../connectors/codex/cx-rollout-meta";
import { computeCxThreadStats } from "../connectors/codex/cx-session-stats";
import { findCodexStateDbPath, listProjectsFromDb } from "../connectors/codex/cx-sqlite";
import { readCxTranscript } from "../connectors/codex/cx-transcript";
import type { CodexTranscriptMessage } from "../types";
import {
	legacyBuildTranscript,
	legacyCxThreadStats,
	legacyReadSessionMeta,
	normalizeTranscript,
	transcriptDigest,
} from "./codex_legacy_reference";

const REAL_ENABLED = process.env.CODEX_PARITY_REAL === "1";
const SAMPLE_SIZE = 20;
const LARGEST = 5;

type Rollout = { id: string; rolloutPath: string; bytes: number };

function indexedRollouts(dbPath: string): Rollout[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		const rows = db.query("SELECT id, rollout_path FROM threads").all() as Array<{ id: string; rollout_path: string }>;
		const rollouts: Rollout[] = [];
		for (const row of rows) {
			if (!row.rollout_path) continue;
			try {
				rollouts.push({ id: row.id, rolloutPath: row.rollout_path, bytes: statSync(row.rollout_path).size });
			} catch {
				/* rollout file is gone */
			}
		}
		return rollouts.sort((a, b) => b.bytes - a.bytes);
	} finally {
		db.close();
	}
}

function sample(rollouts: Rollout[]): Rollout[] {
	const largest = rollouts.slice(0, LARGEST);
	const rest = rollouts.slice(LARGEST);
	const stride = Math.max(1, Math.floor(rest.length / (SAMPLE_SIZE - largest.length)));
	const spread: Rollout[] = [];
	for (let index = 0; index < rest.length && spread.length < SAMPLE_SIZE - largest.length; index += stride) {
		const rollout = rest[index];
		if (rollout) spread.push(rollout);
	}
	return [...largest, ...spread];
}

const normalize = normalizeTranscript;

/**
 * The whole-file builder holds the file, its split lines and the whole transcript at once — a 203 MB
 * rollout needs several GB in one process — so the oracle runs in its own process and reports
 * digests of the last `limit` messages, which the test compares with the streaming builder's output.
 */
function legacyTranscriptDigestsInChildProcess(rolloutPath: string, limits: number[]): LegacyDigests {
	const moduleUrl = new URL("./codex_legacy_reference.ts", import.meta.url).href;
	const script = `
import { legacyBuildTranscript, transcriptDigest } from ${JSON.stringify(moduleUrl)};
const limits = ${JSON.stringify(limits)};
const text = await Bun.file(${JSON.stringify(rolloutPath)}).text();
const messages = legacyBuildTranscript(text);
const digests = {};
for (const limit of limits) digests[String(limit)] = transcriptDigest(messages.slice(-limit));
console.log(JSON.stringify({ messages: messages.length, digests }));
`;
	const result = Bun.spawnSync({ cmd: ["bun", "-e", script], cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`legacy oracle failed for ${rolloutPath}: ${new TextDecoder().decode(result.stderr)}`);
	}
	return JSON.parse(new TextDecoder().decode(result.stdout)) as LegacyDigests;
}

type LegacyDigests = { messages: number; digests: Record<string, string> };

const dbPath = findCodexStateDbPath();
let cachedSample: Rollout[] | null = null;
let cachedTotal = 0;

/** Sampled inside the tests so a skipped run never touches ~/.codex. */
function sampledRollouts(): Rollout[] {
	if (!cachedSample) {
		const all = dbPath ? indexedRollouts(dbPath) : [];
		cachedTotal = all.length;
		cachedSample = sample(all);
		if (REAL_ENABLED) console.log(`[parity] ${cachedTotal} indexed rollouts, sample of ${cachedSample.length}`);
	}
	return cachedSample;
}

describe.skipIf(!REAL_ENABLED)("codex real-data parity", () => {
	it("lists the same projects from the SQLite index as from the rollout tree", async () => {
		expect(dbPath).not.toBeNull();
		const fromIndex = listProjectsFromDb(dbPath!);
		const fromFiles = await listProjectsFromFs();
		const indexCwds = new Set(fromIndex.map((project) => project.path));
		const fileCwds = new Set(fromFiles.map((project) => project.path));

		const fsOnly = [...fileCwds].filter((cwd) => !indexCwds.has(cwd));
		const indexOnly = [...indexCwds].filter((cwd) => !fileCwds.has(cwd));
		const drifted = fromFiles
			.filter((project) => indexCwds.has(project.path))
			.map((project) => {
				const indexed = fromIndex.find((candidate) => candidate.path === project.path);
				return { path: project.path, fileLastOpened: project.lastOpened, indexLastOpened: indexed?.lastOpened };
			})
			.filter((entry) => Math.abs((entry.fileLastOpened ?? 0) - (entry.indexLastOpened ?? 0)) > 60);

		console.log(
			`[parity] projects: index=${fromIndex.length} files=${fromFiles.length} fsOnly=${JSON.stringify(fsOnly)} indexOnly=${JSON.stringify(indexOnly)} timestampsApartByMinute=${drifted.length}`,
		);
		for (const entry of drifted) console.log(`[parity]   lastOpened drift ${JSON.stringify(entry)}`);

		expect(fsOnly).toEqual([]);
		expect(indexOnly).toEqual([]);
	});

	it("reads the same metadata and preview as the whole-file reader", async () => {
		let previewsInsideWindow = 0;
		let previewsOutsideWindow = 0;
		for (const rollout of sampledRollouts()) {
			const text = await Bun.file(rollout.rolloutPath).text();
			const legacy = legacyReadSessionMeta(text);
			const fast = await readRolloutHeadWithPreview(rollout.rolloutPath);
			expect(fast?.id, rollout.rolloutPath).toBe(legacy?.id);
			expect(fast?.cwd, rollout.rolloutPath).toBe(legacy?.cwd);
			if (fast?.preview === legacy?.preview) previewsInsideWindow++;
			else {
				previewsOutsideWindow++;
				// The head window bounds the preview scan, so a preview may only go missing for a rollout
				// whose prompt sits past the window; when it is found it must be the whole-file one.
				expect(Buffer.byteLength(text, "utf8"), rollout.rolloutPath).toBeGreaterThan(PREVIEW_HEAD_WINDOW_BYTES);
				console.log(`[parity] preview past the ${PREVIEW_HEAD_WINDOW_BYTES / 1024} KiB window: ${rollout.rolloutPath}`);
			}
		}
		console.log(`[parity] previews matching=${previewsInsideWindow} beyondWindow=${previewsOutsideWindow}`);
		expect(previewsInsideWindow).toBeGreaterThan(0);
	});

	it("computes the same diff stats as the whole-file scanner", async () => {
		for (const rollout of sampledRollouts()) {
			const text = await Bun.file(rollout.rolloutPath).text();
			const legacy = legacyCxThreadStats(text);
			const fast = await computeCxThreadStats(rollout.rolloutPath, `${rollout.id}:parity`);
			expect(fast, rollout.rolloutPath).toEqual(legacy);
		}
	}, 120_000);

	it("returns the same last messages as the whole-file transcript builder", async () => {
		const limits = [1, 200];
		const sample = sampledRollouts();
		for (const rollout of sample) {
			const legacy = legacyTranscriptDigestsInChildProcess(rollout.rolloutPath, limits);
			for (const limit of limits) {
				const expected = legacy.digests[String(limit)];
				if (!expected) throw new Error(`legacy oracle returned no digest for limit ${limit}`);
				const fast = await readCxTranscript(rollout.rolloutPath, { limit });
				expect(transcriptDigest(fast), `${rollout.rolloutPath} limit=${limit}`).toBe(expected);
			}
			console.log(
				`[parity] ${rollout.bytes} B -> ${legacy.messages} message(s), digests match for limits ${limits.join(",")}`,
			);
		}
	}, 240_000);
});
