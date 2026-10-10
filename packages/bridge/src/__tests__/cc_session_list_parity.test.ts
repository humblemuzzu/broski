import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	legacyComputeCCSessionStats,
	legacyListSessions,
	legacyReadSessionPreview,
} from "../../bench/lib/cc-legacy-oracle";
import { legacyListProjects } from "../../bench/lib/cc-legacy-projects-oracle";
import { buildSyntheticProjects } from "../../bench/lib/cc-synthetic-fixtures";
import { listProjectsFromClaudeDirs } from "../connectors/claude-code/cc-project-list";
import { listSessionsFromProjects } from "../connectors/claude-code/cc-session-list";
import { readSessionPreview, readSessionPreviewCached } from "../connectors/claude-code/cc-session-preview";
import { computeCCSessionStats } from "../connectors/claude-code/cc-session-stats";

let root = "";
let projectsDir = "";
let home = "";
let sessionFiles: string[] = [];

const PROJECT_COUNT = 3;
const SESSIONS_PER_PROJECT = 4;

async function collectSessionFiles(dir: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		for (const file of await readdir(join(dir, entry.name))) {
			if (file.endsWith(".jsonl")) out.push(join(dir, entry.name, file));
		}
	}
	return out.sort();
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "broski-cc-parity-"));
	projectsDir = join(root, "projects");
	home = join(root, "home");
	const documents = join(home, "Documents");
	await buildSyntheticProjects(projectsDir, {
		projects: PROJECT_COUNT,
		sessionsPerProject: SESSIONS_PER_PROJECT,
		cwdPrefix: documents,
		createCwdDirs: true,
		turnsPerSession: 3,
		subagentsPerSession: 2,
		orphanSubagentDirs: 1,
	});

	// A cwd the session store knows about AND the recursive walk can verify: the two sources must
	// collapse to one row.
	const overlapping = join(documents, "project-1");
	await mkdir(join(overlapping, ".claude"), { recursive: true });
	await writeFile(join(overlapping, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));

	const documented = join(documents, "documented");
	await mkdir(join(documented, ".claude"), { recursive: true });
	await writeFile(join(documented, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
	const ignored = join(documents, "cloned", "node_modules", "pkg", ".claude");
	await mkdir(ignored, { recursive: true });
	await writeFile(join(ignored, "settings.local.json"), "{}");
	const unverified = join(home, "StudioProjects", "no-settings");
	await mkdir(join(unverified, ".claude"), { recursive: true });

	sessionFiles = await collectSessionFiles(projectsDir);
});

afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

describe("cc listSessions parity", () => {
	it("matches the whole-file implementation across every project", async () => {
		const actual = await listSessionsFromProjects(undefined, projectsDir);
		const expected = await legacyListSessions(undefined, projectsDir);
		expect(actual).toEqual(expected);
		expect(actual.length).toBeGreaterThan(PROJECT_COUNT * SESSIONS_PER_PROJECT);
	});

	it("matches for a single cwd", async () => {
		const cwd = join(home, "Documents", "project-1");
		const actual = await listSessionsFromProjects(cwd, projectsDir);
		const expected = await legacyListSessions(cwd, projectsDir);
		expect(actual).toEqual(expected);
		expect(actual.length).toBeGreaterThan(0);
	});

	it("matches for a cwd with no sessions dir", async () => {
		const cwd = join(home, "Documents", "does-not-exist");
		expect(await listSessionsFromProjects(cwd, projectsDir)).toEqual([]);
		expect(await legacyListSessions(cwd, projectsDir)).toEqual([]);
	});

	it("shares one run between concurrent callers", async () => {
		const [a, b] = await Promise.all([
			listSessionsFromProjects(undefined, projectsDir),
			listSessionsFromProjects(undefined, projectsDir),
		]);
		expect(a).toBe(b);
	});
});

describe("cc session preview parity", () => {
	it("matches the 200 KB slice reader for every session file", async () => {
		for (const file of sessionFiles) {
			expect(await readSessionPreview(file)).toEqual(await legacyReadSessionPreview(file));
		}
	});

	it("matches for truncated reads", async () => {
		for (const file of sessionFiles) {
			expect(await readSessionPreview(file, 900)).toEqual(await legacyReadSessionPreview(file, 900));
		}
	});

	it("matches for a missing file", async () => {
		const missing = join(root, "nope.jsonl");
		expect(await readSessionPreview(missing)).toEqual(await legacyReadSessionPreview(missing));
	});

	it("caches by fingerprint and recomputes when the file changes", async () => {
		const file = sessionFiles[0]!;
		const first = await readSessionPreviewCached(file);
		expect(await readSessionPreviewCached(file)).toBe(first);

		await writeFile(
			file,
			`${JSON.stringify({ type: "user", uuid: "u-new", cwd: "/tmp/changed", message: { role: "user", content: "changed title" } })}\n`,
		);
		const second = await readSessionPreviewCached(file);
		expect(second).not.toBe(first);
		expect(second.title).toBe("changed title");
		expect(second.cwd).toBe("/tmp/changed");
	});
});

describe("cc session stats parity", () => {
	it("matches the whole-file scan and caches by fingerprint", async () => {
		for (const file of sessionFiles) {
			expect(await computeCCSessionStats(file)).toEqual(await legacyComputeCCSessionStats(file));
		}
		const file = sessionFiles[0]!;
		const before = await stat(file);
		expect(await computeCCSessionStats(file)).toBe(await computeCCSessionStats(file));
		expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
	});

	it("returns null for a missing file like the whole-file scan", async () => {
		expect(await computeCCSessionStats(join(root, "missing.jsonl"))).toBe(null);
		expect(await legacyComputeCCSessionStats(join(root, "missing.jsonl"))).toBe(null);
	});
});

describe("cc listProjects parity", () => {
	it("matches the uncached walk", async () => {
		const actual = await listProjectsFromClaudeDirs({ projectsDir, home });
		const expected = await legacyListProjects(projectsDir, home);
		expect(actual).toEqual(expected);
		expect(actual.some((p) => p.path.endsWith("/documented"))).toBe(true);
		expect(actual.some((p) => p.path.endsWith("/no-settings"))).toBe(false);
		expect(actual.some((p) => p.path.includes("node_modules"))).toBe(false);
	});

	it("collapses a cwd found by both sources into one row", async () => {
		const overlapping = join(home, "Documents", "project-1");
		const actual = await listProjectsFromClaudeDirs({ projectsDir, home });
		expect(actual.filter((p) => p.path === overlapping).length).toBe(1);
	});

	it("shares one run between concurrent callers", async () => {
		const [a, b] = await Promise.all([
			listProjectsFromClaudeDirs({ projectsDir, home }),
			listProjectsFromClaudeDirs({ projectsDir, home }),
		]);
		expect(a).toBe(b);
	});
});
