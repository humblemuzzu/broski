/**
 * Unit tests for the perf-budget checker. The bench runs themselves are not part of `bun test`;
 * this guards the comparison logic that turns a run JSON into a pass/fail.
 */

import { describe, expect, test } from "bun:test";
import { BUDGETS } from "../../bench/budgets";
import { checkBudget, median } from "../../bench/check-budget";
import type { BenchRun, ScenarioResult } from "../../bench/lib/types";

function result(name: string, metrics: Record<string, number | string | boolean>): ScenarioResult {
	return {
		name,
		status: "ok",
		killed: null,
		wallMs: 1,
		startRssBytes: 1,
		peakRssBytes: 1,
		samples: 1,
		cpuUserMs: 1,
		cpuSystemMs: 1,
		metrics,
		error: null,
		stdoutTail: "",
	};
}

function runWith(results: ScenarioResult[], skipped: Array<{ name: string; reason: string }> = []): BenchRun {
	return {
		generatedAt: new Date(0).toISOString(),
		machine: { bunVersion: "x", platform: "p", arch: "a", osVersion: "o", cpu: "c", totalRamBytes: 1 },
		config: { rssCapBytes: 1, timeCapMs: 1, sampleIntervalMs: 1 },
		datasets: [],
		skipped,
		results,
	};
}

function passingMetrics(scenario: string): Record<string, number | string | boolean> {
	const metrics: Record<string, number | string | boolean> = {};
	for (const check of BUDGETS) {
		if (check.scenario !== scenario || check.metric === "wallMs" || check.metric === "peakRssBytes") continue;
		// Bounds are inclusive, so the bound value itself must pass.
		metrics[check.metric] = check.equals ?? check.max ?? check.min ?? 0;
	}
	return metrics;
}

function passingResults(): ScenarioResult[] {
	const scenarios = [...new Set(BUDGETS.map((check) => check.scenario))];
	// `result` sets wallMs and peakRssBytes to 1, below every max the budgets use.
	return scenarios.map((scenario) => result(scenario, passingMetrics(scenario)));
}

describe("checkBudget", () => {
	test("a run exactly on every bound passes", () => {
		const verdict = checkBudget(runWith(passingResults()));
		expect(verdict.failures).toEqual([]);
		expect(verdict.checked).toBe(BUDGETS.length);
	});

	test("a metric over its max fails with the value and the bound", () => {
		const results = passingResults();
		withMetric(results, "server-idle", "rssDeltaBytes", 999_999_999);
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("server-idle.rssDeltaBytes"))).toBe(true);
	});

	test("a metric under its min fails", () => {
		const results = passingResults();
		withMetric(results, "pty-main-thread-stall", "idleSessions", 1);
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("pty-main-thread-stall.idleSessions"))).toBe(true);
	});

	test("an equals check fails on any other value", () => {
		const results = passingResults();
		const target = results.find((entry) => entry.name === "module-load");
		if (target) target.metrics.loadedSdkPackages = "@anthropic-ai/claude-agent-sdk";
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("module-load.loadedSdkPackages"))).toBe(true);
	});

	test("a missing metric fails", () => {
		const results = passingResults();
		delete scenarioIn(results, "pty-main-thread-stall").metrics.yieldSamples;
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("pty-main-thread-stall.yieldSamples"))).toBe(true);
	});

	test("a skipped scenario is not a failure", () => {
		const results = passingResults().filter((entry) => entry.name !== "module-load");
		const verdict = checkBudget(runWith(results, [{ name: "module-load", reason: "missing dataset: x" }]));
		expect(verdict.failures).toEqual([]);
		expect(verdict.skipped).toBe(3);
	});

	test("a scenario absent from the run without being skipped fails", () => {
		const results = passingResults().filter((entry) => entry.name !== "module-load");
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("module-load"))).toBe(true);
	});

	test("a scenario that errored fails even when its metrics look fine", () => {
		const results = passingResults();
		scenarioIn(results, "server-idle").status = "error";
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("server-idle"))).toBe(true);
	});
});

function scenarioIn(results: ScenarioResult[], scenario: string): ScenarioResult {
	const target = results.find((entry) => entry.name === scenario);
	if (!target) throw new Error(`no ${scenario} in the results`);
	return target;
}

function withMetric(results: ScenarioResult[], scenario: string, metric: string, value: number | string | boolean) {
	scenarioIn(results, scenario).metrics[metric] = value;
}

function passingRuns(count: number): BenchRun[] {
	return Array.from({ length: count }, () => runWith(passingResults()));
}

describe("checkBudget across runs", () => {
	// pty-main-thread-stall.idleStallP99Ms is a `median` gate; server-idle.maxChildProcesses is a `worst` gate.
	const noisyP99 = 5000;
	const leakedChildren = 3;

	test("a median gate ignores one noisy run", () => {
		const runs = passingRuns(3);
		withMetric(runs[1]!.results, "pty-main-thread-stall", "idleStallP99Ms", noisyP99);
		const verdict = checkBudget(runs);
		expect(verdict.failures).toEqual([]);
		const line = verdict.lines.find((entry) => entry.includes("idleStallP99Ms"));
		expect(line).toContain("median of 3");
	});

	test("a median gate fails when the middle sample breaks the bound", () => {
		const runs = passingRuns(3);
		withMetric(runs[0]!.results, "pty-main-thread-stall", "idleStallP99Ms", noisyP99);
		withMetric(runs[1]!.results, "pty-main-thread-stall", "idleStallP99Ms", noisyP99);
		const verdict = checkBudget(runs);
		expect(verdict.failures.some((line) => line.includes("pty-main-thread-stall.idleStallP99Ms"))).toBe(true);
	});

	test("a capacity gate fails on a single bad run", () => {
		const runs = passingRuns(3);
		withMetric(runs[2]!.results, "server-idle", "maxChildProcesses", leakedChildren);
		const verdict = checkBudget(runs);
		expect(verdict.failures.some((line) => line.includes("server-idle.maxChildProcesses"))).toBe(true);
	});

	test("an equals gate must hold in every run", () => {
		const runs = passingRuns(3);
		withMetric(runs[2]!.results, "module-load", "loadedSdkPackages", "@anthropic-ai/claude-agent-sdk");
		const verdict = checkBudget(runs);
		expect(verdict.failures.some((line) => line.includes("module-load.loadedSdkPackages"))).toBe(true);
	});

	test("a scenario that errored in one run fails", () => {
		const runs = passingRuns(3);
		scenarioIn(runs[1]!.results, "server-idle").status = "error";
		const verdict = checkBudget(runs);
		expect(verdict.failures.some((line) => line.includes("run 2: scenario error"))).toBe(true);
	});

	test("a scenario present in only some runs is judged on the samples it has", () => {
		const runs = passingRuns(3);
		runs[2]!.results = runs[2]!.results.filter((entry) => entry.name !== "server-idle");
		withMetric(runs[1]!.results, "server-idle", "maxChildProcesses", leakedChildren);
		const verdict = checkBudget(runs);
		expect(verdict.failures.some((line) => line.includes("server-idle.maxChildProcesses"))).toBe(true);
	});

	test("the median of an even sample count is the lower-middle value", () => {
		expect(median([3, 1, 2, 4])).toBe(2);
		expect(median([9])).toBe(9);
	});
});
