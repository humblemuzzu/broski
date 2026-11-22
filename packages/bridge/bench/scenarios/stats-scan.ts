import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatsEngine } from "../../src/stats/engine";
import type { StatsPaths } from "../../src/stats/types";
import { runScenario } from "../lib/report";

const FILE_COUNT = Number(process.env.BENCH_STATS_FILES ?? "40");
const TURNS_PER_FILE = Number(process.env.BENCH_STATS_TURNS ?? "250");

await runScenario(async () => {
	const root = mkdtempSync(join(tmpdir(), "broski-bench-stats-"));
	const piDir = join(root, "pi-sessions");
	const claudeDir = join(root, "claude", "projects", "demo");
	mkdirSync(piDir, { recursive: true });
	mkdirSync(claudeDir, { recursive: true });

	const now = Date.now();
	let corpusBytes = 0;
	for (let f = 0; f < FILE_COUNT; f++) {
		const isClaude = f % 2 === 0;
		const lines: string[] = [];
		const baseTs = now - (f % 20) * 86_400_000;
		if (!isClaude) {
			lines.push(
				JSON.stringify({ type: "session", id: `p-${f}`, cwd: root, timestamp: new Date(baseTs).toISOString() }),
			);
		}
		for (let t = 0; t < TURNS_PER_FILE; t++) {
			const ts = new Date(baseTs + t * 5_000).toISOString();
			if (isClaude) {
				lines.push(
					JSON.stringify({
						type: "assistant",
						timestamp: ts,
						sessionId: `c-${f}`,
						cwd: root,
						requestId: `r-${f}-${t}`,
						message: {
							id: `m-${f}-${t}`,
							model: "claude-sonnet-4-5-20250929",
							content: [{ type: "text", text: "x".repeat(400) }],
							usage: {
								input_tokens: 1_200,
								output_tokens: 450,
								cache_read_input_tokens: 18_000,
								cache_creation_input_tokens: t === 0 ? 18_000 : 0,
							},
						},
					}),
				);
			} else {
				lines.push(
					JSON.stringify({
						type: "message",
						timestamp: ts,
						message: {
							id: `pm-${f}-${t}`,
							role: "assistant",
							provider: "anthropic",
							model: "claude-opus-5-5",
							durationMs: 1_500,
							content: [{ type: "text", text: "y".repeat(400) }],
							usage: { input: 1_000, output: 500, cacheRead: 22_000, cacheWrite: 0, cost: { total: 0 } },
						},
					}),
				);
			}
		}
		const payload = `${lines.join("\n")}\n`;
		corpusBytes += Buffer.byteLength(payload);
		writeFileSync(join(isClaude ? claudeDir : piDir, `session-${f}.jsonl`), payload);
	}

	const paths: StatsPaths = {
		dbPath: join(root, "stats.sqlite"),
		pricingCachePath: join(root, "pricing.json"),
		piSessionsDir: piDir,
		claudeDirs: [join(root, "claude", "projects")],
		claudeStatsCachePath: join(root, "claude", "stats-cache.json"),
		codexHome: join(root, "codex"),
		opencodeHome: join(root, "opencode"),
		antigravityDirs: [],
		grokHome: join(root, "grok"),
		geminiHome: join(root, "gemini"),
	};

	const engine = new StatsEngine(paths, { disableRemotePricing: true });
	try {
		const coldStart = performance.now();
		await engine.scan();
		const coldMs = Math.round(performance.now() - coldStart);

		const warmStart = performance.now();
		await engine.scan();
		const warmMs = Math.round(performance.now() - warmStart);

		const queryStart = performance.now();
		const summary = engine.summary({ range: "month" });
		const queryMs = Math.round((performance.now() - queryStart) * 100) / 100;

		const dbBytes = statSync(paths.dbPath).size;
		const mem = process.memoryUsage();
		return {
			files: FILE_COUNT,
			turns: summary.totals.turns,
			corpusBytes,
			dbBytes,
			coldMs,
			warmMs,
			queryMs,
			rssBytes: mem.rss,
			heapUsedBytes: mem.heapUsed,
		};
	} finally {
		engine.dispose();
		rmSync(root, { recursive: true, force: true });
	}
});
