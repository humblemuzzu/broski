/**
 * `cx_warmup` must reach the rollout tree when the SQLite index is unusable.
 *
 * A Codex process holding a write lock makes every read on the index throw, and warmup used to
 * swallow that and cache nothing. The read-only index now falls back the same way `cx_list_projects`
 * does.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCodexStateDbPath, listProjectsFromDb, listThreadsFromDb } from "../connectors/codex/cx-sqlite";
import { type CxWarmupSources, warmCxCaches } from "../handlers/codex/cx_warmup";
import type { CodexThread, ProjectSummary } from "../types";

const THREADS_SCHEMA =
	"threads (id TEXT, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, model_provider TEXT, " +
	"cwd TEXT, title TEXT, first_user_message TEXT, archived INTEGER, git_branch TEXT, git_origin_url TEXT, " +
	"cli_version TEXT, agent_nickname TEXT, agent_role TEXT)";

const FS_PROJECTS: ProjectSummary[] = [{ id: "/work/from-files", name: "from-files", path: "/work/from-files" }];
const FS_THREADS: CodexThread[] = [
	{ id: "ts-files", preview: "from the rollout tree", createdAt: 1, updatedAt: 2, cwd: "/work/from-files" },
	{ id: "ts-files-2", preview: "also from the rollout tree", createdAt: 3, updatedAt: 4, cwd: "/work/from-files" },
];

let tmpDir = "";
let sqliteHome = "";
let previousSqliteHome: string | undefined;
let writer: Database | null = null;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "broski-cx-warmup-"));
	sqliteHome = join(tmpDir, "codex-home");
	previousSqliteHome = process.env.CODEX_SQLITE_HOME;
	process.env.CODEX_SQLITE_HOME = sqliteHome;
});

afterEach(async () => {
	writer?.close();
	writer = null;
	if (previousSqliteHome === undefined) delete process.env.CODEX_SQLITE_HOME;
	else process.env.CODEX_SQLITE_HOME = previousSqliteHome;
	await rm(tmpDir, { recursive: true, force: true });
});

async function writeDb(): Promise<string> {
	await mkdir(sqliteHome, { recursive: true });
	const path = join(sqliteHome, "state_5.sqlite");
	const db = new Database(path);
	try {
		db.run(`CREATE TABLE ${THREADS_SCHEMA}`);
		db.run("INSERT INTO threads (id, cwd, title, updated_at) VALUES ('t1', '/work/from-index', 'a titled thread', 1)");
	} finally {
		db.close();
	}
	return path;
}

type Harness = {
	sources: CxWarmupSources;
	projects: ProjectSummary[];
	threads: Map<string, CodexThread[]>;
	enriched: CodexThread[];
	logs: string[];
};

function makeHarness(): Harness {
	const harness: Harness = {
		sources: {} as CxWarmupSources,
		projects: [],
		threads: new Map<string, CodexThread[]>(),
		enriched: [],
		logs: [],
	};
	harness.sources = {
		findDbPath: () => findCodexStateDbPath(),
		listProjectsFromDb,
		listThreadsFromDb: (dbPath) => listThreadsFromDb({}, dbPath),
		listProjectsFromFs: async () => FS_PROJECTS,
		listThreadsFromFs: async () => FS_THREADS,
		enrichThreadsWithStats: async (threads) => {
			harness.enriched = [...threads];
		},
		setProjectCache: (projects) => {
			harness.projects = projects;
		},
		setThreadCache: (key, threads) => {
			harness.threads.set(key, threads);
		},
		logInfo: (message) => harness.logs.push(message),
		logError: (message) => harness.logs.push(message),
	};
	return harness;
}

describe("cx_warmup with an unusable SQLite index", () => {
	it("still warms from the rollout tree while Codex holds a write lock", async () => {
		const path = await writeDb();
		writer = new Database(path);
		writer.run("BEGIN EXCLUSIVE");
		writer.run("INSERT INTO threads (id, cwd, title, updated_at) VALUES ('t2', '/work/locked', 'locked', 2)");
		expect(() => listThreadsFromDb({}, path), "the locked index must throw for this test to mean anything").toThrow();

		const harness = makeHarness();
		const warmed = await warmCxCaches(harness.sources, 10);

		expect(warmed).toBe(FS_THREADS.length);
		expect(harness.projects).toEqual(FS_PROJECTS);
		expect(harness.threads.get("__all__")).toEqual(FS_THREADS);
		expect(harness.enriched).toEqual(FS_THREADS);
		expect(harness.logs.join("\n")).toContain("[cx_warmup] SQLite index unavailable");
	});

	it("warms from the index when the database is readable", async () => {
		await writeDb();

		const harness = makeHarness();
		const warmed = await warmCxCaches(harness.sources, 10);

		expect(warmed).toBe(1);
		expect(harness.projects.map((project) => project.path)).toEqual(["/work/from-index"]);
		expect(harness.threads.get("__all__")?.map((thread) => thread.id)).toEqual(["t1"]);
		expect(harness.enriched.map((thread) => thread.id)).toEqual(["t1"]);
	});
});
