/** `stats.summary` routes to the bridge's stats reader, not a backend, and is answered once either way. */

import { describe, expect, test } from "bun:test";
import type { StatsSummaryResult } from "../contract";
import { startCoreRig } from "./helpers/core-rig";

const SUMMARY: StatsSummaryResult = {
	status: "accepted",
	generatedAt: 1_795_000_000_000,
	range: "month",
	resolution: "day",
	timeZone: "UTC",
	sinceDay: "2026-10-24",
	untilDay: "2026-11-22",
	scanState: "fresh",
	fingerprint: { hostId: "h1", volumeId: "v1" },
	totals: {
		tokens: {
			uncachedInput: 1000,
			cachedInput: 5000,
			cacheCreation: 500,
			cacheCreation1h: 0,
			output: 400,
			reasoning: 0,
		},
		cost: { input: 0.003, output: 0.006, cacheRead: 0.0015, cacheWrite: 0.001875, total: 0.012375 },
		speedCost: { standard: 0.012375, fast: 0, ultrafast: 0, premium: 0 },
		cacheSavingsUsd: 0.0135,
		sessions: 1,
		turns: 2,
		activeDays: 1,
		activeMs: 60_000,
		busts: 0,
		idleBusts: 0,
		bustCostUsd: 0,
		unpricedTurns: 0,
		unpricedTokens: 0,
		costSource: "api_estimate",
	},
	harnesses: [],
	models: [],
	projects: [],
	subagents: [],
	series: [],
	sources: [],
	pricing: { status: "bundled", knownModels: 42, unpricedModels: [] },
};

describe("stats.summary", () => {
	test("answers the reader's result", async () => {
		const rig = await startCoreRig({ core: { stats: { summary: async () => SUMMARY } } });
		const phone = await rig.client("phone");
		expect((await phone.ok("stats.summary", { range: "month" })).result).toEqual(SUMMARY);
	});

	test("is unsupported on a bridge that tracks no stats", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("phone");
		const { result } = await phone.ok("stats.summary", { range: "month" });
		expect(result.status === "rejected" && result.rejection.code).toBe("unsupported");
	});
});
