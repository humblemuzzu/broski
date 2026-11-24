import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatsEngine } from "../stats/engine";
import type { StatsPaths } from "../stats/types";

const tempRoots: string[] = [];

function makeTempEnv(): { root: string; paths: StatsPaths } {
	const root = mkdtempSync(join(tmpdir(), "broski-stats-dedup-"));
	tempRoots.push(root);
	const piSessionsDir = join(root, "pi-sessions");
	const claudeProjectsDir = join(root, "claude", "projects");
	const codexHome = join(root, "codex");
	const opencodeHome = join(root, "opencode");
	const antigravityDir = join(root, "antigravity");
	const grokHome = join(root, "grok");
	const geminiHome = join(root, "gemini");
	for (const d of [
		piSessionsDir,
		claudeProjectsDir,
		join(codexHome, "sessions"),
		opencodeHome,
		join(antigravityDir, "conversations"),
		join(grokHome, "sessions"),
		geminiHome,
	]) {
		mkdirSync(d, { recursive: true });
	}
	return {
		root,
		paths: {
			dbPath: join(root, "broski", "stats.sqlite"),
			pricingCachePath: join(root, "broski", "pricing-cache.json"),
			piSessionsDir,
			claudeDirs: [claudeProjectsDir],
			claudeStatsCachePath: join(root, "claude", "stats-cache.json"),
			codexHome,
			opencodeHome,
			antigravityDirs: [antigravityDir],
			grokHome,
			geminiHome,
		},
	};
}

afterEach(() => {
	while (tempRoots.length > 0) {
		const dir = tempRoots.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("StatsEngine deduplication regressions", () => {
	test("OpenCode mid-run partial tokens grow to final totals on rescan without double-counting", async () => {
		const { paths } = makeTempEnv();
		const dbPath = join(paths.opencodeHome, "opencode.db");
		const ts = Date.now() - 10_000;

		const db = new Database(dbPath);
		db.exec(
			"CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);",
		);
		db.run("INSERT INTO session VALUES ('s1', NULL, '/repo/app')");
		db.run("INSERT INTO message VALUES ('m1', 's1', ?, ?)", [
			ts,
			JSON.stringify({
				role: "assistant",
				providerID: "anthropic",
				modelID: "claude-sonnet-4-5",
				tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } },
				cost: 0,
				time: { created: ts },
			}),
		]);
		db.close();

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			let summary = engine.summary({ range: "month", harness: "opencode", timeZone: "UTC" });
			expect(summary.totals.tokens.uncachedInput).toBe(100);
			expect(summary.totals.tokens.output).toBe(60);

			await Bun.sleep(15);
			const db2 = new Database(dbPath);
			db2.run("UPDATE message SET data = ? WHERE id = 'm1'", [
				JSON.stringify({
					role: "assistant",
					providerID: "anthropic",
					modelID: "claude-sonnet-4-5",
					tokens: { input: 100, output: 200, reasoning: 40, cache: { read: 50, write: 20 } },
					cost: 0,
					time: { created: ts, completed: ts + 500 },
				}),
			]);
			db2.close();

			await engine.scan();
			summary = engine.summary({ range: "month", harness: "opencode", timeZone: "UTC" });
			expect(summary.totals.tokens.uncachedInput).toBe(100);
			expect(summary.totals.tokens.output).toBe(240);
			expect(summary.totals.tokens.reasoning).toBe(40);
			expect(summary.totals.tokens.cachedInput).toBe(50);
			expect(summary.totals.tokens.cacheCreation).toBe(20);
			expect(summary.totals.turns).toBe(1);
		} finally {
			engine.dispose();
		}
	});

	test("Pi imports of Claude, Codex, and OpenCode sessions with reasoning tokens do not double-count", async () => {
		const { paths } = makeTempEnv();
		const now = Date.now() - 60_000;
		const iso = new Date(now).toISOString();

		const claudeProj = join(paths.claudeDirs[0] ?? "", "p1");
		mkdirSync(claudeProj, { recursive: true });
		writeFileSync(
			join(claudeProj, "c1.jsonl"),
			`${JSON.stringify({
				type: "assistant",
				timestamp: iso,
				requestId: "req-1",
				sessionId: "c1",
				cwd: "/repo/app",
				message: {
					id: "msg-c1",
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 1000,
						output_tokens: 400,
						cache_read_input_tokens: 200,
						cache_creation_input_tokens: 50,
					},
				},
			})}\n`,
		);

		writeFileSync(
			join(paths.codexHome, "sessions", "rollout-x1.jsonl"),
			`${[
				JSON.stringify({ type: "session_meta", timestamp: iso, payload: { id: "x1", cwd: "/repo/app" } }),
				JSON.stringify({ type: "turn_context", timestamp: iso, payload: { model: "gpt-5.4" } }),
				JSON.stringify({
					type: "event_msg",
					timestamp: iso,
					payload: {
						type: "token_count",
						info: {
							last_token_usage: {
								input_tokens: 900,
								cached_input_tokens: 300,
								output_tokens: 250,
								reasoning_output_tokens: 50,
							},
						},
					},
				}),
			].join("\n")}\n`,
		);

		const ocDb = new Database(join(paths.opencodeHome, "opencode.db"));
		ocDb.exec(
			"CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);",
		);
		ocDb.run("INSERT INTO session VALUES ('oc1', NULL, '/repo/app')");
		ocDb.run("INSERT INTO message VALUES ('om1', 'oc1', ?, ?)", [
			now,
			JSON.stringify({
				role: "assistant",
				providerID: "anthropic",
				modelID: "claude-sonnet-4-5",
				tokens: { input: 500, output: 120, reasoning: 80, cache: { read: 10, write: 5 } },
				cost: 0,
				time: { created: now, completed: now },
			}),
		]);
		ocDb.close();

		const piDir = join(paths.piSessionsDir, "proj");
		mkdirSync(piDir, { recursive: true });
		const writePiImport = (name: string, label: string, usage: Record<string, number>) => {
			writeFileSync(
				join(piDir, name),
				`${[
					JSON.stringify({ type: "session", id: name, cwd: "/repo/app", timestamp: iso }),
					JSON.stringify({ type: "session_info", timestamp: iso, name: `${label} imported` }),
					JSON.stringify({
						type: "message",
						timestamp: iso,
						message: {
							role: "assistant",
							provider: "anthropic",
							model: "claude-sonnet-4-5",
							usage,
							stopReason: "stop",
						},
					}),
				].join("\n")}\n`,
			);
		};
		writePiImport("imp-claude.jsonl", "[claude]", { input: 1000, output: 400, cacheRead: 200, cacheWrite: 50 });
		writePiImport("imp-codex.jsonl", "[codex]", { input: 600, output: 250, cacheRead: 300, cacheWrite: 0 });
		writePiImport("imp-opencode.jsonl", "[opencode]", { input: 500, output: 200, cacheRead: 10, cacheWrite: 5 });

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			const piSummary = engine.summary({ range: "month", harness: "pi", timeZone: "UTC" });
			expect(piSummary.totals.turns).toBe(0);
			const all = engine.summary({ range: "month", timeZone: "UTC" });
			expect(all.totals.turns).toBe(3);
		} finally {
			engine.dispose();
		}
	});
});
