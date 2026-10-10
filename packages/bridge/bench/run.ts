import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { killProcessTree, runChild } from "./lib/child-runner";
import { collectDatasets } from "./lib/datasets";
import { renderMarkdown } from "./lib/markdown";
import { SCENARIOS, SELFTEST } from "./lib/scenarios";
import { collectMachineInfo } from "./lib/system-info";
import type { BenchRun, ScenarioResult } from "./lib/types";

const BRIDGE_ROOT = resolve(import.meta.dir, "..");
const RESULTS_DIR = resolve(import.meta.dir, "results");
const DEFAULT_RSS_CAP_BYTES = 3 * 1024 ** 3;
const HARD_RSS_CAP_BYTES = 4 * 1024 ** 3;
const DEFAULT_TIME_CAP_MS = 120_000;
const SAMPLE_INTERVAL_MS = 100;
const SELFTEST_RSS_CAP_BYTES = 200 * 1024 ** 2;

type Options = {
	rssCapBytes: number;
	timeCapMs: number;
	filter: string[];
	selftest: boolean;
};

function argValue(flag: string): string | null {
	const prefix = `${flag}=`;
	for (const arg of process.argv.slice(2)) {
		if (arg.startsWith(prefix)) return arg.slice(prefix.length);
	}
	return null;
}

function parseOptions(): Options {
	const rssMb = Number.parseFloat(argValue("--cap-rss-mb") ?? "");
	const timeMs = Number.parseFloat(argValue("--cap-time-ms") ?? "");
	let rssCapBytes = Number.isFinite(rssMb) ? Math.round(rssMb * 1024 ** 2) : DEFAULT_RSS_CAP_BYTES;
	if (rssCapBytes > HARD_RSS_CAP_BYTES) {
		console.error("[bench] rss cap clamped to 4096 MB (hard limit)");
		rssCapBytes = HARD_RSS_CAP_BYTES;
	}
	const filterArg = argValue("--filter");
	return {
		rssCapBytes,
		timeCapMs: Number.isFinite(timeMs) ? Math.round(timeMs) : DEFAULT_TIME_CAP_MS,
		filter: filterArg
			? filterArg
					.split(",")
					.map((entry) => entry.trim())
					.filter((entry) => entry.length > 0)
			: [],
		selftest: process.argv.includes("--selftest"),
	};
}

function childEnv(extra: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") out[key] = value;
	}
	return { ...out, ...extra };
}

async function runSelftest(): Promise<number> {
	const result = await runChild({
		name: SELFTEST.name,
		scriptPath: resolve(import.meta.dir, "scenarios", `${SELFTEST.name}.ts`),
		cwd: BRIDGE_ROOT,
		env: childEnv({ BENCH_SELFTEST_MB: "400" }),
		rssCapBytes: SELFTEST_RSS_CAP_BYTES,
		timeCapMs: 30_000,
		sampleIntervalMs: 50,
	});
	const ok = result.killed === "rss";
	console.log(
		`[bench] selftest killed=${result.killed} peakRss=${(result.peakRssBytes / 1024 ** 2).toFixed(1)} MB wall=${result.wallMs} ms -> ${ok ? "PASS" : "FAIL"}`,
	);
	return ok ? 0 : 1;
}

function statusLabel(result: ScenarioResult): string {
	if (result.killed === "rss") return "KILLED(rss)";
	if (result.killed === "time") return "KILLED(time)";
	return result.status;
}

async function main(): Promise<void> {
	const options = parseOptions();
	if (options.selftest) {
		process.exitCode = await runSelftest();
		return;
	}

	const machine = collectMachineInfo();
	console.log(
		`[bench] bun ${machine.bunVersion} · macOS ${machine.osVersion} · ${machine.cpu} · ${(machine.totalRamBytes / 1024 ** 3).toFixed(0)} GiB RAM`,
	);
	console.log(
		`[bench] caps: rss ${(options.rssCapBytes / 1024 ** 2).toFixed(0)} MB, time ${options.timeCapMs} ms, sample ${SAMPLE_INTERVAL_MS} ms`,
	);

	const datasets = await collectDatasets();
	const specs =
		options.filter.length > 0
			? SCENARIOS.filter((s) => options.filter.some((f) => s.name === f || s.name.startsWith(f)))
			: SCENARIOS;
	const results: ScenarioResult[] = [];

	for (const spec of specs) {
		process.stdout.write(`[bench] ${spec.name} ... `);
		const extraEnv: Record<string, string> = {};
		let tempHome: string | null = null;
		if (spec.needsTempHome) {
			tempHome = await mkdtemp(join(tmpdir(), `broski-bench-${spec.name}-`));
			extraEnv.HOME = tempHome;
			extraEnv.BROSKI_TLS = "0";
		}
		const result = await runChild({
			name: spec.name,
			scriptPath: resolve(import.meta.dir, "scenarios", `${spec.name}.ts`),
			cwd: BRIDGE_ROOT,
			env: childEnv(extraEnv),
			rssCapBytes: options.rssCapBytes,
			timeCapMs: options.timeCapMs,
			sampleIntervalMs: SAMPLE_INTERVAL_MS,
		});
		if (tempHome) await rm(tempHome, { recursive: true, force: true });
		results.push(result);
		process.stdout.write(
			`${statusLabel(result)} ${result.wallMs} ms peak ${(result.peakRssBytes / 1024 ** 2).toFixed(1)} MB\n`,
		);
	}

	const run: BenchRun = {
		generatedAt: new Date().toISOString(),
		machine,
		config: { rssCapBytes: options.rssCapBytes, timeCapMs: options.timeCapMs, sampleIntervalMs: SAMPLE_INTERVAL_MS },
		datasets,
		results,
	};

	await mkdir(RESULTS_DIR, { recursive: true });
	const fileName = `${run.generatedAt.replace(/[:.]/g, "-")}-bun${machine.bunVersion}.json`;
	const filePath = resolve(RESULTS_DIR, fileName);
	await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`);

	console.log(`\n[bench] wrote ${filePath}\n`);
	console.log(renderMarkdown(run));
}

void main().catch((err: unknown) => {
	console.error("[bench] fatal:", err instanceof Error ? err.stack : String(err));
	killProcessTree(process.pid);
	process.exitCode = 1;
});
