import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCxProjects } from "../handlers/codex/cx_projects";
import type { ProjectSummary } from "../types";

let tmpDir = "";
let previousSqliteHome: string | undefined;
let writer: Database | null = null;

const FALLBACK: ProjectSummary[] = [{ id: "/work/from-files", name: "from-files", path: "/work/from-files" }];

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "broski-cx-sqlite-"));
	previousSqliteHome = process.env.CODEX_SQLITE_HOME;
	process.env.CODEX_SQLITE_HOME = join(tmpDir, "codex-home");
});

afterEach(async () => {
	writer?.close();
	writer = null;
	if (previousSqliteHome === undefined) delete process.env.CODEX_SQLITE_HOME;
	else process.env.CODEX_SQLITE_HOME = previousSqliteHome;
	await rm(tmpDir, { recursive: true, force: true });
});

async function writeDb(columns: string, rows: Array<Record<string, string | number>>): Promise<string> {
	const dir = join(tmpDir, "codex-home");
	await mkdir(dir, { recursive: true });
	const path = join(dir, "state_5.sqlite");
	const db = new Database(path);
	try {
		db.run(`CREATE TABLE threads (${columns})`);
		for (const row of rows) {
			const keys = Object.keys(row);
			db.run(
				`INSERT INTO threads (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
				keys.map((key) => row[key] ?? null),
			);
		}
	} finally {
		db.close();
	}
	return path;
}

function resolveProjects() {
	return resolveCxProjects({
		listProjectsFromFs: async () => FALLBACK,
		ensureCodexClient: () => Promise.reject(new Error("the app-server must not be needed")),
		safeString: (value) => (typeof value === "string" ? value : ""),
		logInfo: () => {},
	});
}

describe("cx_list_projects with an unusable SQLite index", () => {
	it("still answers from the rollout tree while Codex holds a write lock", async () => {
		const path = await writeDb("id TEXT, cwd TEXT, title TEXT, updated_at INTEGER", [
			{ id: "t1", cwd: "/work/from-index", title: "a titled thread", updated_at: 1 },
		]);
		writer = new Database(path);
		writer.run("BEGIN EXCLUSIVE");
		writer.run("INSERT INTO threads (id, cwd, title, updated_at) VALUES ('t2', '/work/locked', '', 2)");

		const result = await resolveProjects();

		expect(result.source).toBe("filesystem");
		expect(result.projects.map((project) => project.path)).toEqual(["/work/from-files"]);
	});

	it("still answers from the rollout tree when the schema moved on", async () => {
		await writeDb("id TEXT, cwd TEXT, title TEXT", [{ id: "t1", cwd: "/work/from-index", title: "a titled thread" }]);

		const result = await resolveProjects();

		expect(result.source).toBe("filesystem");
		expect(result.projects.map((project) => project.path)).toEqual(["/work/from-files"]);
	});

	it("answers from the index when the database is readable", async () => {
		await writeDb("id TEXT, cwd TEXT, title TEXT, updated_at INTEGER", [
			{ id: "t1", cwd: "/work/from-index", title: "a titled thread", updated_at: 1 },
		]);

		const result = await resolveProjects();

		expect(result.source).toBe("sqlite");
		expect(result.projects.map((project) => project.path)).toEqual(["/work/from-index"]);
	});
});
