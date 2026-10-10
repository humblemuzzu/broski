import { writeSync } from "node:fs";
import type { ChildPayload, ScenarioMetrics, ScenarioMetricsInput } from "./types";

export const RESULT_PREFIX = "__BENCH_RESULT__";

function compact(input: ScenarioMetricsInput): ScenarioMetrics {
	const out: ScenarioMetrics = {};
	for (const [key, value] of Object.entries(input)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

export async function runScenario(work: () => Promise<ScenarioMetricsInput>): Promise<void> {
	const startedAtMs = Date.now();
	let metrics: ScenarioMetrics = {};
	let error: string | null = null;

	try {
		metrics = compact(await work());
	} catch (err) {
		error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
	}

	const cpu = process.cpuUsage();
	const payload: ChildPayload = {
		metrics,
		error,
		childWallMs: Date.now() - startedAtMs,
		cpuUserMs: Math.round(cpu.user / 1000),
		cpuSystemMs: Math.round(cpu.system / 1000),
		rssAtExitBytes: process.memoryUsage.rss(),
	};

	writeSync(1, `\n${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
	process.exit(0);
}
