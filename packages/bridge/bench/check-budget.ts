/**
 * Compares a `bench/run.ts` JSON run against the perf budgets in `budgets.ts`.
 *
 * Usage: `bun bench/check-budget.ts [path-to-run.json]` (defaults to the newest file in
 * `bench/results/`). Exit code 1 when any check fails, 0 otherwise. Scenarios the run skipped
 * (missing real data on a bare CI runner) are reported and not failed.
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

export type BudgetVerdict = {
	failures: string[];
	lines: string[];
	checked: number;
	skipped: number;
};

export function checkBudget(run: BenchRun): BudgetVerdict {
	const byName = new Map(run.results.map((result) => [result.name, result]));
	const skippedNames = new Set(run.skipped.map((entry) => entry.name));
	const failures: string[] = [];
	const lines: string[] = [];
	let checked = 0;
	let skipped = 0;

	for (const check of BUDGETS) {
		const label = `${check.scenario}.${check.metric}`;
		const result = byName.get(check.scenario);
		if (!result) {
			if (skippedNames.has(check.scenario)) {
				skipped += 1;
				lines.push(`SKIP  ${label} (scenario skipped: ${run.skipped.find((s) => s.name === check.scenario)?.reason})`);
			} else {
				failures.push(`${label}: scenario did not run`);
				lines.push(`FAIL  ${label} (scenario missing from the run)`);
			}
			continue;
		}
		if (result.status !== "ok") {
			failures.push(`${label}: scenario status is ${result.status}${result.error ? ` (${result.error})` : ""}`);
			lines.push(`FAIL  ${label} (scenario ${result.status})`);
			continue;
		}
		const value = metricValue(result, check.metric);
		if (value === undefined || value === null) {
			failures.push(`${label}: metric absent`);
			lines.push(`FAIL  ${label} (metric absent)`);
			continue;
		}
		checked += 1;
		if (check.equals !== undefined) {
			if (value !== check.equals) {
				failures.push(`${label}: expected ${fmt(check.equals)}, got ${fmt(value)}`);
				lines.push(`FAIL  ${label} = ${fmt(value)} (expected ${fmt(check.equals)})`);
			} else {
				lines.push(`ok    ${label} = ${fmt(value)}`);
			}
			continue;
		}
		if (typeof value !== "number") {
			failures.push(`${label}: expected a number, got ${fmt(value)}`);
			lines.push(`FAIL  ${label} = ${fmt(value)} (not a number)`);
			continue;
		}
		if (check.min !== undefined && value < check.min) {
			failures.push(`${label}: ${fmt(value)} < min ${fmt(check.min)}`);
			lines.push(`FAIL  ${label} = ${fmt(value)} (min ${fmt(check.min)})`);
			continue;
		}
		if (check.max !== undefined && value > check.max) {
			failures.push(`${label}: ${fmt(value)} > max ${fmt(check.max)}`);
			lines.push(`FAIL  ${label} = ${fmt(value)} (max ${fmt(check.max)})`);
			continue;
		}
		lines.push(
			`ok    ${label} = ${fmt(value)}${check.max !== undefined ? ` (max ${fmt(check.max)})` : ""}${check.min !== undefined ? ` (min ${fmt(check.min)})` : ""}`,
		);
	}

	return { failures, lines, checked, skipped };
}

function main(): void {
	const path = process.argv[2] ? resolve(process.argv[2]) : latestResultPath();
	const run = JSON.parse(readFileSync(path, "utf-8")) as BenchRun;
	console.log(`[budget] ${path}`);
	console.log(`[budget] machine: ${run.machine.cpu} · ${run.machine.bunVersion}`);
	const verdict = checkBudget(run);
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
