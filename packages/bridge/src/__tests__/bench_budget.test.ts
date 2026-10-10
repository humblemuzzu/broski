/**
 * Unit tests for the perf-budget checker. The bench runs themselves are not part of `bun test`;
 * this guards the comparison logic that turns a run JSON into a pass/fail.
 */

import { describe, expect, test } from "bun:test";
import { BUDGETS } from "../../bench/budgets";
import { checkBudget } from "../../bench/check-budget";
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
		const target = results.find((entry) => entry.name === "soak-sessions");
		if (target) target.metrics.cpuMs = 999_999;
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("soak-sessions.cpuMs"))).toBe(true);
	});

	test("a metric under its min fails", () => {
		const results = passingResults();
		const target = results.find((entry) => entry.name === "soak-sessions");
		if (target) target.metrics.views = 1;
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("soak-sessions.views"))).toBe(true);
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
		const target = results.find((entry) => entry.name === "stream-throughput");
		if (target) delete target.metrics.c1_charsMin;
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("stream-throughput.c1_charsMin"))).toBe(true);
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
		const target = results.find((entry) => entry.name === "stream-stalled-client");
		if (target) target.status = "error";
		const verdict = checkBudget(runWith(results));
		expect(verdict.failures.some((line) => line.includes("stream-stalled-client"))).toBe(true);
	});
});
