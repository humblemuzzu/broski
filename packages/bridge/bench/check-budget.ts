/**
 * Compares one or more `bench/run.ts` JSON runs against the perf budgets in `budgets.ts`.
 *
 * Usage: `bun bench/check-budget.ts <run.json> [more-run.json ...]` (defaults to the newest file in
 * `bench/results/`). Exit code 1 when any check fails, 0 otherwise. Scenarios the runs skipped
 * (missing real data on a bare CI runner) are reported and not failed.
 *
 * With several runs, a check carrying `gate: "median"` — every time-derived bound — is judged on the
 * median of the samples, so one shared-runner latency spike does not fail the job. Every other check
 * is judged on the worst sample: a leak, a dropped message, an extra frame or a count regression in
 * any single run still fails.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { BUDGETS, type BudgetCheck } from "./budgets";
import type { BenchRun, MetricValue, ScenarioResult } from "./lib/types";

const RESULTS_DIR = resolve(import.meta.dir, "results");

function latestResultPath(): string {
	const files = readdirSync(RESULTS_DIR)
		.filter((name) => name.endsWith(".json"))
		.map((name) => resolve(RESULTS_DIR, name))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	const latest = files[0];
	if (!latest) throw new Error(`no bench results in ${RESULTS_DIR}; run 'bun bench/run.ts' first`);
	return latest;
}

function metricValue(result: ScenarioResult, metric: string): MetricValue | undefined {
	if (metric === "wallMs") return result.wallMs;
	if (metric === "peakRssBytes") return result.peakRssBytes;
	if (metric === "status") return result.status;
	return result.metrics[metric];
}

function fmt(value: unknown): string {
	if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
	return String(value);
}

/** Lower-middle sample for an even count: no interpolation, so a gate never passes on invented data. */
export function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN;
}

export type BudgetVerdict = {
	failures: string[];
	lines: string[];
	checked: number;
	skipped: number;
};

type Sample = { run: number; value: MetricValue };

function requiredDirection(check: BudgetCheck): "min" | "max" {
	return check.max !== undefined ? "max" : "min";
}

/** The sample a `worst` gate is judged on: the largest for a max bound, the smallest for a min bound. */
function worstSample(samples: Sample[], check: BudgetCheck): Sample {
	const direction = requiredDirection(check);
	return samples.reduce((worst, sample) => {
		if (typeof worst.value !== "number" || typeof sample.value !== "number") return worst;
		if (direction === "max" ? sample.value > worst.value : sample.value < worst.value) return sample;
		return worst;
	});
}

function aggregationOf(check: BudgetCheck, sampleCount: number, runIndex: number): string {
	if (sampleCount < 2) return "";
	if (check.gate === "median") return `, median of ${sampleCount}`;
	return `, worst of ${sampleCount} (run ${runIndex})`;
}

export function checkBudget(input: BenchRun | BenchRun[]): BudgetVerdict {
	const runs = Array.isArray(input) ? input : [input];
	const skippedNames = new Set(runs.flatMap((run) => run.skipped.map((entry) => entry.name)));
	const failures: string[] = [];
	const lines: string[] = [];
	let checked = 0;
	let skipped = 0;

	for (const check of BUDGETS) {
		const label = `${check.scenario}.${check.metric}`;
		const samples: Sample[] = [];
		const broken: string[] = [];

		for (const [index, run] of runs.entries()) {
			const result = run.results.find((entry) => entry.name === check.scenario);
			if (!result) continue;
			if (result.status !== "ok") {
				broken.push(`run ${index + 1}: scenario ${result.status}${result.error ? ` (${result.error})` : ""}`);
				continue;
			}
			const value = metricValue(result, check.metric);
			if (value === undefined || value === null) {
				broken.push(`run ${index + 1}: metric absent`);
				continue;
			}
			samples.push({ run: index + 1, value });
		}

		if (broken.length > 0) {
			failures.push(`${label}: ${broken.join("; ")}`);
			lines.push(`FAIL  ${label} (${broken.join("; ")})`);
			continue;
		}

		if (samples.length === 0) {
			if (skippedNames.has(check.scenario)) {
				skipped += 1;
				const reason = runs.flatMap((run) => run.skipped).find((entry) => entry.name === check.scenario)?.reason;
				lines.push(`SKIP  ${label} (scenario skipped: ${reason})`);
			} else {
				failures.push(`${label}: scenario did not run`);
				lines.push(`FAIL  ${label} (scenario missing from the run)`);
			}
			continue;
		}

		checked += 1;

		if (check.equals !== undefined) {
			const mismatched = samples.filter((sample) => sample.value !== check.equals);
			if (mismatched.length > 0) {
				const detail = mismatched.map((sample) => `run ${sample.run} = ${fmt(sample.value)}`).join(", ");
				failures.push(`${label}: expected ${fmt(check.equals)}, got ${detail}`);
				lines.push(`FAIL  ${label} = ${detail} (expected ${fmt(check.equals)})`);
			} else {
				lines.push(`ok    ${label} = ${fmt(check.equals)}${samples.length > 1 ? `, ${samples.length} runs` : ""}`);
			}
			continue;
		}

		const nonNumeric = samples.find((sample) => typeof sample.value !== "number");
		if (nonNumeric) {
			failures.push(`${label}: expected a number, got ${fmt(nonNumeric.value)}`);
			lines.push(`FAIL  ${label} = ${fmt(nonNumeric.value)} (not a number)`);
			continue;
		}

		const numbers = samples.map((sample) => sample.value as number);
		let value: number;
		let suffix: string;
		if (check.gate === "median" && numbers.length > 1) {
			value = median(numbers);
			suffix = `, median of ${numbers.length}`;
		} else {
			const worst = worstSample(samples, check);
			value = worst.value as number;
			suffix = aggregationOf(check, samples.length, worst.run);
		}
		const boundLabel =
			check.max !== undefined ? `max ${fmt(check.max)}` : check.min !== undefined ? `min ${fmt(check.min)}` : "";

		if (check.min !== undefined && value < check.min) {
			failures.push(`${label}: ${fmt(value)} < min ${fmt(check.min)}`);
			lines.push(`FAIL  ${label} = ${fmt(value)} (min ${fmt(check.min)}${suffix})`);
			continue;
		}
		if (check.max !== undefined && value > check.max) {
			failures.push(`${label}: ${fmt(value)} > max ${fmt(check.max)}`);
			lines.push(`FAIL  ${label} = ${fmt(value)} (max ${fmt(check.max)}${suffix})`);
			continue;
		}
		lines.push(`ok    ${label} = ${fmt(value)} (${boundLabel}${suffix})`);
	}

	return { failures, lines, checked, skipped };
}

function main(): void {
	const args = process.argv.slice(2);
	const files = args.length > 0 ? args.map((path) => resolve(path)) : [latestResultPath()];
	const runs = files.map((file) => JSON.parse(readFileSync(file, "utf-8")) as BenchRun);

	console.log(`[budget] ${files.join(" ")}`);
	console.log(`[budget] machine: ${runs[0]?.machine.cpu ?? "?"} · ${runs[0]?.machine.bunVersion ?? "?"}`);
	if (runs.length > 1)
		console.log(`[budget] ${runs.length} runs: time gates on the median, everything else worst-case`);

	const verdict = checkBudget(runs);
	for (const line of verdict.lines) console.log(`[budget] ${line}`);
	console.log(`[budget] ${verdict.checked} checked, ${verdict.skipped} skipped, ${verdict.failures.length} failed`);
	if (verdict.failures.length > 0) {
		console.error(`[budget] FAILED:\n  - ${verdict.failures.join("\n  - ")}`);
		process.exitCode = 1;
	} else {
		console.log("[budget] PASS");
	}
}

if (import.meta.main) {
	try {
		main();
	} catch (error) {
		console.error(`[budget] error: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}

export type { BudgetCheck };
