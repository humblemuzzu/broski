import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { StatsSummary } from "../contract";
import { StatsEngine } from "../stats/engine";
import { PriceBook } from "../stats/pricing";
import { machineStats } from "../stats/service";
import { decodeMetadataBlob } from "../stats/sources/antigravity";
import { StatsStore } from "../stats/store";
import type { StatsPaths } from "../stats/types";

const tempDirs: string[] = [];

function makeTempEnv(): { root: string; paths: StatsPaths } {
	const root = mkdtempSync(join(tmpdir(), "broski-stats-test-"));
	tempDirs.push(root);
	const piSessionsDir = join(root, "pi-sessions");
	const claudeProjectsDir = join(root, "claude", "projects");
	const codexHome = join(root, "codex");
	const opencodeHome = join(root, "opencode");
	const antigravityDir = join(root, "antigravity");
	const grokHome = join(root, "grok");
	const geminiHome = join(root, "gemini-tmp");
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
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("PriceBook", () => {
	test("prices 5m vs 1h cache writes, long-context >200k tier, fast speed tier, and cache savings", () => {
		const book = new PriceBook();
		const base = book.priceTurn(
			"anthropic",
			"claude-sonnet-4-5-20250929",
			{
				uncachedInput: 100_000,
				cachedInput: 50_000,
				cacheCreation: 20_000,
				cacheCreation1h: 5_000,
				output: 10_000,
				reasoning: 2_000,
			},
			"standard",
			undefined,
		);
		expect(base.contextTier).toBe("base");
		expect(base.costSource).toBe("api_estimate");
		// 100k * $3/M = $0.30, 50k * $0.30/M = $0.015, 15k * $3.75/M + 5k * $6/M = $0.08625, 10k * $15/M = $0.15
		expect(base.inputUsd).toBeCloseTo(0.3, 6);
		expect(base.cacheReadUsd).toBeCloseTo(0.015, 6);
		expect(base.cacheWriteUsd).toBeCloseTo(0.08625, 6);
		expect(base.outputUsd).toBeCloseTo(0.15, 6);
		expect(base.cacheSavingsUsd).toBeGreaterThan(0);

		const longCtx = book.priceTurn(
			"anthropic",
			"claude-sonnet-4-5",
			{
				uncachedInput: 50_000,
				cachedInput: 180_000,
				cacheCreation: 0,
				cacheCreation1h: 0,
				output: 10_000,
				reasoning: 0,
			},
			"standard",
			undefined,
		);
		expect(longCtx.contextTier).toBe("long200k");
		expect(longCtx.inputUsd).toBeCloseTo(0.3, 6); // 50k * $6/M

		const fast = book.priceTurn(
			"openai",
			"gpt-5.4",
			{
				uncachedInput: 100_000,
				cachedInput: 0,
				cacheCreation: 0,
				cacheCreation1h: 0,
				output: 10_000,
				reasoning: 0,
			},
			"fast",
			undefined,
		);
		expect(fast.speedPremiumUsd).toBeGreaterThan(0);
		expect(fast.totalUsd).toBeCloseTo(fast.speedPremiumUsd * 2, 6);
	});

	test("bills Claude 4.6 and later at base rates across the 1M window", () => {
		const book = new PriceBook();
		const tokens = {
			uncachedInput: 100_000,
			cachedInput: 400_000,
			cacheCreation: 0,
			cacheCreation1h: 0,
			output: 10_000,
			reasoning: 0,
		};
		const opus = book.priceTurn("anthropic", "claude-opus-5-5", tokens, "standard", undefined);
		expect(opus.contextTier).toBe("base");
		// 100k * $4/M + 400k * $0.20/M + 10k * $20/M
		expect(opus.totalUsd).toBeCloseTo(0.4 + 0.08 + 0.2, 6);
		expect(book.priceTurn("anthropic", "claude-sonnet-4-6", tokens, "standard", undefined).contextTier).toBe("base");
	});

	test("keeps a bundled fast-mode multiplier when a refreshed catalog card has none", () => {
		const { root } = makeTempEnv();
		const cachePath = join(root, "pricing-cache.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				version: 1,
				fetchedAt: Date.now(),
				rates: { "anthropic/claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
			}),
		);
		const book = new PriceBook({ cachePath, disableRemote: true });
		const tokens = {
			uncachedInput: 1_000_000,
			cachedInput: 0,
			cacheCreation: 0,
			cacheCreation1h: 0,
			output: 0,
			reasoning: 0,
		};
		expect(book.priceTurn("anthropic", "claude-opus-4-6", tokens, "fast", undefined).totalUsd).toBeCloseTo(30, 6);
	});

	test("marks unknown models as unpriced rather than $0 free", () => {
		const book = new PriceBook();
		const res = book.priceTurn(
			"custom",
			"mystery-model-9000",
			{ uncachedInput: 1_000, cachedInput: 0, cacheCreation: 0, cacheCreation1h: 0, output: 500, reasoning: 0 },
			"standard",
			undefined,
		);
		expect(res.unpriced).toBe(true);
		expect(res.costSource).toBe("unpriced");
		expect(res.totalUsd).toBe(0);
	});
});

describe("StatsEngine parsers and deduplication", () => {
	test("Claude Code deduplicates streaming chunks, handles missing requestId, drops /btw sidechain replays, and counts advisor iterations", async () => {
		const { root, paths } = makeTempEnv();
		const nowIso = new Date().toISOString();
		const projectDir = join(paths.claudeDirs[0]!, "my-project");
		mkdirSync(join(projectDir, "sess-1", "subagents"), { recursive: true });

		const lines = [
			// Streaming chunk 1 then chunk 2 for same message+request: only delta should count.
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				cwd: join(root, "repo"),
				requestId: "req-1",
				message: {
					id: "msg-1",
					model: "claude-sonnet-4-5-20250929",
					usage: {
						input_tokens: 1000,
						output_tokens: 200,
						cache_read_input_tokens: 5000,
						cache_creation_input_tokens: 0,
					},
				},
			}),
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				cwd: join(root, "repo"),
				requestId: "req-1",
				message: {
					id: "msg-1",
					model: "claude-sonnet-4-5-20250929",
					usage: {
						input_tokens: 1000,
						output_tokens: 600,
						cache_read_input_tokens: 5000,
						cache_creation_input_tokens: 0,
					},
				},
			}),
			// /btw sidechain replay of msg-1 with a new requestId: must be dropped.
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				isSidechain: true,
				requestId: "req-btw",
				message: {
					id: "msg-1",
					model: "claude-sonnet-4-5-20250929",
					usage: {
						input_tokens: 1000,
						output_tokens: 600,
						cache_read_input_tokens: 5000,
						cache_creation_input_tokens: 0,
					},
				},
			}),
			// Gateway response without requestId emitted twice: must dedupe on message.id.
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				message: {
					id: "msg-noreq",
					model: "claude-haiku-4-5",
					usage: { input_tokens: 500, output_tokens: 100 },
				},
			}),
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				message: {
					id: "msg-noreq",
					model: "claude-haiku-4-5",
					usage: { input_tokens: 500, output_tokens: 100 },
				},
			}),
			// Advisor iteration inside usage.iterations[].
			JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				requestId: "req-adv",
				message: {
					id: "msg-adv",
					model: "claude-sonnet-4-5",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						iterations: [{ type: "advisor_message", model: "claude-opus-4-5", input_tokens: 200, output_tokens: 100 }],
					},
				},
			}),
		];
		const mainFile = join(projectDir, "sess-1.jsonl");
		writeFileSync(mainFile, `${lines.join("\n")}\n`);

		// Subagent transcript with .meta.json.
		const subFile = join(projectDir, "sess-1", "subagents", "agent-1.jsonl");
		writeFileSync(subFile.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "Explore" }));
		writeFileSync(
			subFile,
			`${JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				requestId: "req-sub",
				message: {
					id: "msg-sub",
					model: "claude-haiku-4-5",
					usage: { input_tokens: 400, output_tokens: 80 },
				},
			})}\n`,
		);

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			const summary = engine.summary({ range: "week" });
			expect(StatsSummary.safeParse(summary).success).toBe(true);
			// Input: 1000 (msg-1) + 500 (msg-noreq) + 100 (msg-adv) + 200 (advisor) + 400 (sub) = 2200
			expect(summary.totals.tokens.uncachedInput).toBe(2200);
			// Output: 600 + 100 + 50 + 100 + 80 = 930
			expect(summary.totals.tokens.output).toBe(930);
			expect(summary.totals.tokens.cachedInput).toBe(5000);
			expect(summary.subagents.map((s) => s.name).sort()).toEqual(["Explore", "advisor"]);

			// Append one new turn and verify incremental byte-offset resume counts ONLY the new turn.
			const appendLine = JSON.stringify({
				type: "assistant",
				timestamp: nowIso,
				sessionId: "sess-1",
				requestId: "req-2",
				message: {
					id: "msg-2",
					model: "claude-sonnet-4-5",
					usage: { input_tokens: 300, output_tokens: 70 },
				},
			});
			writeFileSync(mainFile, `${lines.join("\n")}\n${appendLine}\n`);
			await engine.scan();
			const afterAppend = engine.summary({ range: "week" });
			expect(afterAppend.totals.tokens.uncachedInput).toBe(2500);
			expect(afterAppend.totals.tokens.output).toBe(1000);

			// Delete source file and rescan: retained history must NEVER be wiped.
			unlinkSync(mainFile);
			await engine.scan();
			const afterDelete = engine.summary({ range: "week" });
			expect(afterDelete.totals.tokens.uncachedInput).toBe(2500);
			expect(afterDelete.totals.tokens.output).toBe(1000);
		} finally {
			engine.dispose();
		}
	});

	test("Codex collapses identical repeats, subtracts cached_input_tokens, handles restarts, and detects speed tiers", async () => {
		const { paths } = makeTempEnv();
		const nowIso = new Date().toISOString();
		const rollout = join(paths.codexHome, "sessions", "rollout-2026-00000000-0000-4000-8000-000000000001.jsonl");
		const repeatEvent = JSON.stringify({
			timestamp: nowIso,
			type: "event_msg",
			payload: {
				type: "token_count",
				info: {
					total_token_usage: {
						input_tokens: 10_000,
						cached_input_tokens: 8_000,
						output_tokens: 1_000,
						reasoning_output_tokens: 400,
						total_tokens: 11_000,
					},
					last_token_usage: {
						input_tokens: 10_000,
						cached_input_tokens: 8_000,
						output_tokens: 1_000,
						reasoning_output_tokens: 400,
					},
				},
			},
		});
		const lines = [
			JSON.stringify({
				timestamp: nowIso,
				type: "session_meta",
				payload: { id: "codex-1", cwd: "/tmp/proj", model_provider: "openai" },
			}),
			JSON.stringify({
				timestamp: nowIso,
				type: "turn_context",
				payload: { model: "gpt-5.4", effort: "high" },
			}),
			JSON.stringify({
				timestamp: nowIso,
				type: "event_msg",
				payload: { type: "thread_settings_applied", thread_settings: { service_tier: "priority" } },
			}),
			repeatEvent,
			repeatEvent, // Byte-identical re-emission: must be ignored!
		];
		writeFileSync(rollout, `${lines.join("\n")}\n`);

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			const summary = engine.summary({ range: "week" });
			// 10_000 total input - 8_000 cached = 2_000 uncached input!
			expect(summary.totals.tokens.uncachedInput).toBe(2_000);
			expect(summary.totals.tokens.cachedInput).toBe(8_000);
			expect(summary.totals.tokens.output).toBe(1_000);
			expect(summary.totals.tokens.reasoning).toBe(400);
			expect(summary.totals.speedCost.fast).toBeGreaterThan(0);
			expect(summary.totals.speedCost.premium).toBeGreaterThan(0);
		} finally {
			engine.dispose();
		}
	});

	test("Pi handles parentSession forks, cache-ping, nested subagents, and recorded costs", async () => {
		const { paths } = makeTempEnv();
		const t1 = Date.now() - 120_000;
		const t2 = Date.now() - 60_000;
		const parentPath = join(paths.piSessionsDir, "parent.jsonl");
		const forkPath = join(paths.piSessionsDir, "fork.jsonl");

		const parentLines = [
			JSON.stringify({ type: "session", id: "pi-parent", cwd: "/tmp/p", timestamp: new Date(t1).toISOString() }),
			JSON.stringify({
				type: "message",
				timestamp: new Date(t1 + 1000).toISOString(),
				message: {
					id: "m1",
					role: "assistant",
					provider: "anthropic",
					model: "claude-opus-5-5",
					durationMs: 2000,
					usage: { input: 2000, output: 1000, cacheRead: 25_000, cacheWrite: 0, cost: { total: 0.04 } },
				},
			}),
			JSON.stringify({
				type: "custom_message",
				customType: "agent-result",
				timestamp: new Date(t1 + 2000).toISOString(),
				details: {
					runs: [{ agent: "chad", status: "done", usage: { input: 500, output: 200, turns: 3, cost: 0.01 } }],
				},
			}),
			// The same run's own record and the background launch's tool result: neither may count again.
			JSON.stringify({
				type: "custom",
				customType: "agent-run",
				timestamp: new Date(t1 + 1900).toISOString(),
				data: { agent: "chad", status: "done", usage: { input: 500, output: 200, turns: 3, cost: 0.01 } },
			}),
			JSON.stringify({
				type: "message",
				timestamp: new Date(t1 + 1500).toISOString(),
				message: {
					role: "toolResult",
					toolName: "chad",
					details: { agent: "chad", background: true, continueId: "chad-1" },
				},
			}),
		];
		writeFileSync(parentPath, `${parentLines.join("\n")}\n`);

		const forkLines = [
			JSON.stringify({
				type: "session",
				id: "pi-fork",
				cwd: "/tmp/p",
				parentSession: parentPath,
				timestamp: new Date(t2).toISOString(),
			}),
			// Pre-fork copied message (t1 + 1000 < t2): must be skipped!
			parentLines[1],
			// Post-fork message: must count.
			JSON.stringify({
				type: "message",
				timestamp: new Date(t2 + 1000).toISOString(),
				message: {
					id: "m2",
					role: "assistant",
					provider: "anthropic",
					model: "claude-opus-5-5",
					durationMs: 1000,
					usage: { input: 1000, output: 500, cacheRead: 25_000, cacheWrite: 0, cost: { total: 0 } },
				},
			}),
		];
		writeFileSync(forkPath, `${forkLines.join("\n")}\n`);

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			const summary = engine.summary({ range: "week" });
			expect(summary.totals.turns).toBe(5);
			expect(summary.totals.tokens.uncachedInput).toBe(3500);
			expect(summary.totals.tokens.output).toBe(1700);
			expect(summary.totals.costSource).toBe("mixed");
			expect(summary.subagents.length).toBe(1);
			expect(summary.subagents[0]?.name).toBe("chad");
			expect(summary.subagents[0]?.runs).toBe(1);
			expect(summary.subagents[0]?.turns).toBe(3);
			expect(summary.subagents[0]?.costUsd).toBeCloseTo(0.01, 9);
		} finally {
			engine.dispose();
		}
	});

	test("OpenCode SQLite, Grok Build, Gemini CLI, and Antigravity protobuf all ingest cleanly", async () => {
		const { paths } = makeTempEnv();
		const now = Date.now();
		const nowIso = new Date(now).toISOString();

		// OpenCode SQLite DB
		const ocDb = new Database(join(paths.opencodeHome, "opencode.db"), { create: true });
		ocDb.run(
			"CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)",
		);
		ocDb.run(
			"CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)",
		);
		ocDb.run("INSERT INTO session VALUES ('oc-1', '', '/tmp/oc', 'test', ?, ?)", [now, now]);
		// More rows than one read page, so every page boundary is crossed.
		for (let i = 0; i < 150; i++) {
			ocDb.run("INSERT INTO message VALUES (?, 'oc-1', ?, ?, ?)", [
				`oc-m${i}`,
				now,
				now,
				JSON.stringify({
					role: "assistant",
					providerID: "openai",
					modelID: "gpt-5",
					tokens: { input: 4000, output: 1000, reasoning: 200, cache: { read: 1000, write: 0 } },
					cost: 0,
					time: { created: now - i, completed: now + 500 - i },
				}),
			]);
		}
		ocDb.close(false);

		// Grok Build updates.jsonl
		mkdirSync(join(paths.grokHome, "sessions", "g-1"), { recursive: true });
		writeFileSync(
			join(paths.grokHome, "sessions", "g-1", "updates.jsonl"),
			`${JSON.stringify({
				params: {
					sessionId: "g-1",
					_meta: { agentTimestampMs: now },
					update: {
						sessionUpdate: "turn_completed",
						promptId: "p1",
						model: "grok-4.6",
						usage: { inputTokens: 3000, cachedReadTokens: 1000, outputTokens: 500, costUsdTicks: 50_000_000 },
					},
				},
			})}\n`,
		);

		// Gemini CLI session JSON
		mkdirSync(join(paths.geminiHome, "proj-1", "chats"), { recursive: true });
		writeFileSync(
			join(paths.geminiHome, "proj-1", "chats", "session-1.json"),
			JSON.stringify({
				sessionId: "gem-1",
				startTime: nowIso,
				messages: [
					{
						id: "gm1",
						type: "gemini",
						timestamp: nowIso,
						model: "gemini-2.5-pro",
						tokens: { input: 2000, cached: 500, output: 400, thoughts: 100 },
					},
				],
			}),
		);

		// Antigravity nested protobuf helper unit verification (step metadata: field 9 = usage)
		const usageBytes = new Uint8Array([
			0x08,
			0x89,
			0x0b, // field 1 (modelId) = 1417 (gemini-4-argon)
			0x10,
			0xe8,
			0x07, // field 2 (uncachedInput) = 1000
			0x18,
			0xc8,
			0x01, // field 3 (output) = 200
			0x28,
			0xf4,
			0x03, // field 5 (cachedInput) = 500
		]);
		const stepBlob = new Uint8Array([0x4a, usageBytes.length, ...usageBytes]);
		const decoded = decodeMetadataBlob(stepBlob, true);
		expect(decoded?.modelId).toBe(1417);
		expect(decoded?.usages.length).toBe(1);

		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			const summary = engine.summary({ range: "day" });
			expect(StatsSummary.safeParse(summary).success).toBe(true);
			expect(summary.resolution).toBe("hour");
			expect(summary.series.length).toBe(24);
			const harnesses = summary.harnesses.map((h) => h.harness).sort();
			expect(harnesses).toEqual(["gemini", "grok", "opencode"]);
			expect(summary.harnesses.find((h) => h.harness === "opencode")?.turns).toBe(150);
			// Gemini bills thoughts as output on top of the candidates, and its prompt count holds the cached share.
			const gemini = summary.harnesses.find((h) => h.harness === "gemini")?.tokens;
			expect(gemini?.output).toBe(500);
			expect(gemini?.uncachedInput).toBe(1500);
			expect(gemini?.cachedInput).toBe(500);
		} finally {
			engine.dispose();
		}
	});

	test("machineStats worker serves stats.summary end-to-end off the main thread", async () => {
		const { paths } = makeTempEnv();
		const nowIso = new Date().toISOString();
		writeFileSync(
			join(paths.piSessionsDir, "s1.jsonl"),
			`${[
				JSON.stringify({ type: "session", id: "w-1", cwd: "/tmp/w", timestamp: nowIso }),
				JSON.stringify({
					type: "message",
					timestamp: nowIso,
					message: {
						id: "wm1",
						role: "assistant",
						provider: "anthropic",
						model: "claude-sonnet-4-5",
						usage: { input: 5000, output: 1000, cacheRead: 20_000, cacheWrite: 0, cost: { total: 0 } },
					},
				}),
			].join("\n")}\n`,
		);

		const service = machineStats(paths.piSessionsDir, paths.dbPath, () => {}, paths, { disableRemotePricing: true });
		try {
			const res = await service.summary({ range: "month", refresh: true });
			expect(res.status).toBe("accepted");
			if (res.status === "accepted") {
				expect(res.totals.turns).toBe(1);
				expect(res.totals.tokens.uncachedInput).toBe(5000);
				expect(res.totals.cost.total).toBeGreaterThan(0);
			}
		} finally {
			await service.dispose();
		}
	});

	test("active time counts only the gaps between turns inside the window", async () => {
		const { paths } = makeTempEnv();
		const start = Date.now() - 10 * 86_400_000;
		const recent = Date.now() - 2 * 3_600_000;
		const turn = (ms: number) =>
			JSON.stringify({
				type: "message",
				timestamp: new Date(ms).toISOString(),
				message: {
					role: "assistant",
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
				},
			});
		writeFileSync(
			join(paths.piSessionsDir, "long.jsonl"),
			`${[
				JSON.stringify({ type: "session", id: "long-1", cwd: "/tmp/l", timestamp: new Date(start).toISOString() }),
				turn(start + 60_000),
				turn(start + 6 * 60_000),
				turn(recent),
				turn(recent + 4 * 60_000),
			].join("\n")}\n`,
		);
		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			expect(engine.summary({ range: "week" }).totals.activeMs).toBe(4 * 60_000);
			expect(engine.summary({ range: "month" }).totals.activeMs).toBe(9 * 60_000);
		} finally {
			engine.dispose();
		}
	});

	test("a ledger written by another schema version is rebuilt, not reused", () => {
		const { paths } = makeTempEnv();
		mkdirSync(dirname(paths.dbPath), { recursive: true });
		const old = new Database(paths.dbPath, { create: true });
		old.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		old.run("INSERT INTO meta VALUES ('schema_version', '2')");
		old.run("CREATE TABLE turns_daily (day TEXT, harness TEXT, cost_total REAL)");
		old.run("INSERT INTO turns_daily VALUES ('2026-11-01', 'pi', 9999)");
		old.close(false);

		const store = new StatsStore(paths.dbPath);
		try {
			expect(store.db.query("SELECT COUNT(*) AS n FROM turns_daily").get()).toEqual({ n: 0 });
			expect(store.db.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "3" });
		} finally {
			store.close();
		}
	});

	test("repriceStaleBuckets updates costs inside SQLite without re-reading JSONL files", async () => {
		const { paths } = makeTempEnv();
		const nowIso = new Date().toISOString();
		const file = join(paths.piSessionsDir, "unknown.jsonl");
		writeFileSync(
			file,
			`${[
				JSON.stringify({ type: "session", id: "reprice-1", cwd: "/tmp/r", timestamp: nowIso }),
				JSON.stringify({
					type: "message",
					timestamp: nowIso,
					message: {
						id: "rm1",
						role: "assistant",
						provider: "custom",
						model: "brand-new-model-x",
						usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
					},
				}),
			].join("\n")}\n`,
		);
		const engine = new StatsEngine(paths, { disableRemotePricing: true });
		try {
			await engine.scan();
			expect(engine.summary({ range: "week" }).totals.unpricedTurns).toBe(1);
			expect(engine.summary({ range: "week" }).totals.cost.total).toBe(0);
			// Delete raw file, register new price, and reprice purely from SQLite.
			unlinkSync(file);
			engine.priceBook.setOverride("custom", "brand-new-model-x", { input: 4.5, output: 12 });
			const updated = engine.store.repriceStaleBuckets(engine.priceBook);
			expect(updated).toBeGreaterThanOrEqual(1);
			const after = engine.summary({ range: "week" });
			expect(after.totals.unpricedTurns).toBe(0);
			expect(after.totals.cost.total).toBeCloseTo(4.5, 4);
		} finally {
			engine.dispose();
		}
	});
});
