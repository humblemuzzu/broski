import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectsFromFs } from "../connectors/codex/cx-projects";
import type { RolloutRoots } from "../connectors/codex/cx-rollout-files";
import { cachedRolloutHead, readRolloutHead, readRolloutHeadWithPreview } from "../connectors/codex/cx-rollout-meta";
import { computeCxThreadStats, getCxModifiedFiles } from "../connectors/codex/cx-session-stats";
import { enrichThreadsWithStats, resolveRolloutPaths } from "../connectors/codex/cx-thread-enrich";
import { readCxTranscript } from "../connectors/codex/cx-transcript";
import { resolveCxProjects } from "../handlers/codex/cx_projects";
import type { CodexThread, CodexTranscriptMessage } from "../types";
import { legacyBuildTranscript, legacyCxThreadStats, legacyReadSessionMeta } from "./codex_legacy_reference";

let tmpDir = "";
let previousSqliteHome: string | undefined;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "broski-cx-rollout-"));
	previousSqliteHome = process.env.CODEX_SQLITE_HOME;
	process.env.CODEX_SQLITE_HOME = join(tmpDir, "no-index");
});

afterEach(async () => {
	if (previousSqliteHome === undefined) delete process.env.CODEX_SQLITE_HOME;
	else process.env.CODEX_SQLITE_HOME = previousSqliteHome;
	await rm(tmpDir, { recursive: true, force: true });
});

const metaLine = (id: string, cwd: string, payloadExtra: Record<string, unknown> = {}): string =>
	JSON.stringify({
		timestamp: "2026-01-01T00:00:00.000Z",
		ordinal: 0,
		type: "session_meta",
		payload: {
			id,
			cwd,
			cli_version: "0.9.0",
			model_provider: "openai",
			git: { branch: "main" },
			...payloadExtra,
		},
	});

const userMessage = (message: string): string =>
	JSON.stringify({ type: "event_msg", payload: { type: "user_message", message } });

const reasoning = (text: string): string =>
	JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", text } });

const assistantText = (text: string): string =>
	JSON.stringify({
		type: "response_item",
		payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
	});

const shellCall = (callId: string, command: string): string =>
	JSON.stringify({
		type: "response_item",
		payload: { type: "function_call", name: "shell_command", call_id: callId, arguments: JSON.stringify({ command }) },
	});

const shellOutput = (callId: string, output: string): string =>
	JSON.stringify({ type: "response_item", payload: { type: "function_call_output", call_id: callId, output } });

const applyPatchCall = (callId: string, patch: string): string =>
	JSON.stringify({
		type: "response_item",
		payload: { type: "custom_tool_call", name: "apply_patch", call_id: callId, status: "completed", input: patch },
	});

const PATCH = [
	"*** Begin Patch",
	"*** Update File: src/a.ts",
	"@@",
	"-old line",
	"+new line",
	"+another line",
	"*** Update File: src/b.ts",
	"@@",
	"-gone",
	"*** End Patch",
].join("\n");

type Fixture = RolloutRoots & { sessionsFile: string; archivedFile: string };

async function writeRollout(roots: RolloutRoots, relativePath: string, lines: string[], mtime?: Date): Promise<string> {
	const path = join(roots.sessionsDir, relativePath);
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, `${lines.join("\n")}\n`);
	if (mtime) await utimes(path, mtime, mtime);
	return path;
}

async function makeRoots(): Promise<RolloutRoots> {
	const sessionsDir = join(tmpDir, "sessions");
	const archivedDir = join(tmpDir, "archived_sessions");
	await mkdir(sessionsDir, { recursive: true });
	await mkdir(archivedDir, { recursive: true });
	return { sessionsDir, archivedDir };
}

const normalize = (messages: CodexTranscriptMessage[]): unknown[] =>
	messages.map((message) => ({
		role: message.role,
		text: message.text,
		thinking: message.thinking ?? null,
		toolCalls: message.toolCalls ?? [],
		diffs: (message.diffs ?? []).map((diff) => ({
			file: diff.file,
			diff: diff.diff,
			additions: diff.additions,
			deletions: diff.deletions,
			itemId: diff.itemId,
		})),
	}));

describe("codex rollout head reader", () => {
	it("reads session_meta without parsing the rest of the file", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-a.jsonl", [
			metaLine("thread-a", "/work/alpha"),
			"not json at all",
		]);
		const head = await readRolloutHead(path);
		expect(head?.id).toBe("thread-a");
		expect(head?.cwd).toBe("/work/alpha");
		expect(head?.gitBranch).toBe("main");
	});

	it("grows the head window when session_meta does not fit the first read", async () => {
		const roots = await makeRoots();
		const padded = metaLine("thread-b", "/work/beta", { base_instructions: { text: "x".repeat(40_000) } });
		const path = await writeRollout(roots, "2026/01/01/rollout-b.jsonl", [padded, userMessage("hello")]);
		expect((await readRolloutHead(path))?.id).toBe("thread-b");
	});

	it("returns null when the first record is not session_meta", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-c.jsonl", [userMessage("no meta")]);
		expect(await readRolloutHead(path)).toBeNull();
	});

	it("matches the whole-file reader for metadata and preview", async () => {
		const roots = await makeRoots();
		const lines = [
			metaLine("thread-d", "/work/delta"),
			JSON.stringify({
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "<user_instructions>rules</user_instructions>" }],
				},
			}),
			userMessage("## My request for Codex:\nfix the parser"),
			reasoning("looking"),
		];
		const path = await writeRollout(roots, "2026/01/01/rollout-d.jsonl", lines);
		const expected = legacyReadSessionMeta(`${lines.join("\n")}\n`);
		const actual = await readRolloutHeadWithPreview(path);
		expect(actual?.id).toBe(expected?.id);
		expect(actual?.cwd).toBe(expected?.cwd);
		expect(actual?.preview).toBe(expected?.preview);
		expect(actual?.preview).toBe("fix the parser");
	});

	it("caches the head per path", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-e.jsonl", [metaLine("thread-e", "/work/eps")]);
		expect((await cachedRolloutHead(path))?.id).toBe("thread-e");
		expect((await cachedRolloutHead(path))?.id).toBe("thread-e");
	});
});

describe("codex project list from rollout heads", () => {
	it("dedupes by cwd, keeps the latest mtime and sorts newest first", async () => {
		const roots = await makeRoots();
		await writeRollout(
			roots,
			"2026/01/01/rollout-a.jsonl",
			[metaLine("t1", "/work/alpha")],
			new Date("2026-01-01T00:00:00Z"),
		);
		await writeRollout(
			roots,
			"2026/02/01/rollout-b.jsonl",
			[metaLine("t2", "/work/alpha")],
			new Date("2026-03-01T00:00:00Z"),
		);
		await writeRollout(
			roots,
			"2026/03/01/rollout-c.jsonl",
			[metaLine("t3", "/work/beta")],
			new Date("2026-02-01T00:00:00Z"),
		);
		await writeRollout(roots, "2026/03/02/rollout-d.jsonl", [userMessage("no meta")]);
		const archivedPath = join(roots.archivedDir, "rollout-old.jsonl");
		await writeFile(archivedPath, `${metaLine("t4", "/work/gamma")}\n`);
		await utimes(archivedPath, new Date("2025-12-01T00:00:00Z"), new Date("2025-12-01T00:00:00Z"));

		const projects = await listProjectsFromFs(roots);
		expect(projects.map((project) => project.path)).toEqual(["/work/alpha", "/work/beta", "/work/gamma"]);
		expect(projects[0]?.name).toBe("alpha");
		expect(projects[0]?.lastOpened).toBe(Math.floor(new Date("2026-03-01T00:00:00Z").getTime() / 1000));
	});
});

describe("codex thread stats", () => {
	it("matches the whole-file scanner across all three diff formats", async () => {
		const roots = await makeRoots();
		const lines = [
			metaLine("thread-stats", "/work/stats"),
			userMessage("patch it"),
			applyPatchCall("call-1", PATCH),
			JSON.stringify({
				type: "event_msg",
				payload: { item: { type: "fileChange", changes: [{ path: "src/c.ts", diff: "@@\n+one\n-two\n" }] } },
			}),
		];
		const path = await writeRollout(roots, "2026/01/01/rollout-stats.jsonl", lines);
		const expected = legacyCxThreadStats(`${lines.join("\n")}\n`);
		expect(await computeCxThreadStats(path, "thread-stats")).toEqual(expected);
		expect(await getCxModifiedFiles(path)).toEqual([
			{ file: "src/a.ts", additions: 2, deletions: 2 },
			{ file: "src/b.ts", additions: 2, deletions: 2 },
			{ file: "src/c.ts", additions: 1, deletions: 1 },
		]);
	});

	it("recomputes when the file changes and reuses the cached value when it does not", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-cache.jsonl", [
			metaLine("thread-cache", "/work/cache"),
			applyPatchCall("call-1", PATCH),
		]);
		expect((await computeCxThreadStats(path, "thread-cache"))?.additions).toBe(4);

		await writeFile(path, `${[metaLine("thread-cache", "/work/cache"), applyPatchCall("call-1", PATCH)].join("\n")}\n`);
		expect((await computeCxThreadStats(path, "thread-cache"))?.additions).toBe(4);

		await writeFile(
			path,
			`${[metaLine("thread-cache", "/work/cache"), applyPatchCall("call-1", PATCH), applyPatchCall("call-2", PATCH)].join("\n")}\n`,
		);
		expect((await computeCxThreadStats(path, "thread-cache"))?.additions).toBe(8);

		const cached = await computeCxThreadStats(path, "thread-cache");
		const again = await computeCxThreadStats(path, "thread-cache");
		expect(again).toBe(cached);
	});
});

describe("codex thread enrichment", () => {
	it("resolves rollout paths from the filesystem when no index exists", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-x.jsonl", [metaLine("thread-x", "/work/x")]);
		const resolved = await resolveRolloutPaths(["thread-x", "missing"], roots);
		expect(resolved.get("thread-x")).toBe(path);
		expect(resolved.has("missing")).toBe(false);
	});

	it("attaches summaries only to threads without one", async () => {
		const roots = await makeRoots();
		await writeRollout(roots, "2026/01/01/rollout-y.jsonl", [
			metaLine("thread-y", "/work/y"),
			applyPatchCall("call-1", PATCH),
		]);
		await writeRollout(roots, "2026/01/01/rollout-z.jsonl", [metaLine("thread-z", "/work/z")]);

		const threads: CodexThread[] = [
			{ id: "thread-y", preview: "y", createdAt: 1, updatedAt: 1, cwd: "/work/y" },
			{ id: "thread-z", preview: "z", createdAt: 1, updatedAt: 1, cwd: "/work/z" },
			{ id: "thread-missing", preview: "m", createdAt: 1, updatedAt: 1, cwd: "/work/m" },
			{
				id: "thread-done",
				preview: "d",
				createdAt: 1,
				updatedAt: 1,
				cwd: "/work/d",
				summary: { additions: 5, deletions: 5, files: 5 },
			},
		];

		await enrichThreadsWithStats(threads, { roots });
		expect(threads[0]?.summary).toEqual({ additions: 4, deletions: 4, files: 2 });
		expect(threads[1]?.summary).toBeUndefined();
		expect(threads[2]?.summary).toBeUndefined();
		expect(threads[3]?.summary).toEqual({ additions: 5, deletions: 5, files: 5 });
	});
});

describe("cx_list_projects source order", () => {
	async function writeIndex(rows: Array<{ id: string; cwd: string; title: string }>): Promise<void> {
		const dbPath = join(tmpDir, "no-index", "state_5.sqlite");
		await mkdir(join(tmpDir, "no-index"), { recursive: true });
		const db = new Database(dbPath);
		try {
			db.run("CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER, rollout_path TEXT)");
			for (const [index, row] of rows.entries()) {
				db.run("INSERT INTO threads (id, cwd, title, updated_at, rollout_path) VALUES (?, ?, ?, ?, ?)", [
					row.id,
					row.cwd,
					row.title,
					1_800_000_000 + index,
					"",
				]);
			}
		} finally {
			db.close();
		}
	}

	it("answers from the index without reading the rollout tree", async () => {
		await writeIndex([
			{ id: "t1", cwd: "/work/from-index", title: "a titled thread" },
			{ id: "t2", cwd: "/work/untitled", title: "" },
		]);
		let filesystemCalls = 0;
		const result = await resolveCxProjects({
			listProjectsFromFs: async () => {
				filesystemCalls++;
				return [{ id: "/work/from-files", name: "from-files", path: "/work/from-files" }];
			},
			ensureCodexClient: () => Promise.reject(new Error("app-server must not be needed")),
			safeString: (value) => (typeof value === "string" ? value : ""),
			logInfo: () => {},
		});

		expect(result.source).toBe("sqlite");
		expect(filesystemCalls).toBe(0);
		// An untitled thread still has a cwd, and its rollout file belongs to the same project.
		expect(result.projects.map((project) => project.path).sort()).toEqual(["/work/from-index", "/work/untitled"]);
	});

	it("falls back to the rollout tree when there is no index", async () => {
		const result = await resolveCxProjects({
			listProjectsFromFs: async () => [{ id: "/work/from-files", name: "from-files", path: "/work/from-files" }],
			ensureCodexClient: () => Promise.reject(new Error("app-server must not be needed")),
			safeString: (value) => (typeof value === "string" ? value : ""),
			logInfo: () => {},
		});

		expect(result.source).toBe("filesystem");
		expect(result.projects.map((project) => project.path)).toEqual(["/work/from-files"]);
	});
});

describe("codex transcript", () => {
	const transcriptLines = [
		metaLine("thread-t", "/work/t"),
		userMessage("first turn"),
		reasoning("thinking one"),
		shellCall("call-1", "ls"),
		shellOutput("call-1", "a\nb"),
		assistantText("done one"),
		userMessage("second turn"),
		reasoning("thinking two"),
		applyPatchCall("call-2", PATCH),
		assistantText("done two"),
	];

	it("keeps the last N messages exactly as the whole-file builder produces them", async () => {
		const roots = await makeRoots();
		const path = await writeRollout(roots, "2026/01/01/rollout-transcript.jsonl", transcriptLines);
		const legacy = legacyBuildTranscript(`${transcriptLines.join("\n")}\n`);

		for (const limit of [1, 2, 3, 4, 50]) {
			const actual = await readCxTranscript(path, { limit });
			expect(normalize(actual)).toEqual(normalize(legacy.slice(-limit)));
		}
		expect(legacy.length).toBe(4);
	});

	it("returns an empty transcript for a missing file", async () => {
		expect(await readCxTranscript(join(tmpDir, "nope.jsonl"))).toEqual([]);
	});

	it("truncates long tool outputs and counts diff lines exactly as the whole-file builder does", async () => {
		const roots = await makeRoots();
		const patchBody = [
			"*** Begin Patch",
			"*** Update File: src/long.ts",
			"@@",
			"--- a/src/long.ts",
			"+++ b/src/long.ts",
			"-removed one",
			"-removed two",
			"+added one",
			"+added two",
			"+added three",
			"*** End Patch",
		].join("\n");

		const exactWindow = Array.from({ length: 85 }, (_, index) => `line ${index}`).join("\n");
		const overWindow = Array.from({ length: 86 }, (_, index) => `line ${index} ${"x".repeat(40)}`).join("\n");
		const lines = [
			metaLine("thread-trunc", "/work/trunc"),
			userMessage("trim it"),
			shellCall("call-exact", "cat small"),
			shellOutput("call-exact", exactWindow),
			shellCall("call-over", "cat big"),
			shellOutput("call-over", overWindow),
			applyPatchCall("call-patch", patchBody),
			assistantText("trimmed"),
		];
		const path = await writeRollout(roots, "2026/01/01/rollout-trunc.jsonl", lines);
		const legacy = legacyBuildTranscript(`${lines.join("\n")}\n`);
		const fast = await readCxTranscript(path, { limit: 10 });

		expect(normalize(fast)).toEqual(normalize(legacy));
		expect(fast[1]?.toolCalls?.[0]?.output).toBe(exactWindow);
		expect(fast[1]?.toolCalls?.[1]?.output).toContain("... (6 lines omitted) ...");
		expect(fast[1]?.diffs?.[0]).toEqual({
			file: "src/long.ts",
			diff: patchBody,
			additions: 3,
			deletions: 2,
			itemId: "call-patch",
		});
	});
});
