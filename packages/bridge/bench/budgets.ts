/**
 * Perf budgets for the synthetic bench subsection CI runs, applied by `bench/check-budget.ts`.
 * `bench/BUDGETS.md` records the measured values the bounds are based on.
 *
 * Capacity bounds (bytes, counts of memory) sit at ~2x the worst value seen on the macOS dev machine
 * and the 2-vCPU Linux container, so a leak or an unbounded scan fails; wall/CPU/latency bounds sit at
 * ~4x, because a shared runner swings those the most.
 */

export type BudgetCheck = {
	scenario: string;
	/** A `ScenarioResult` field (`wallMs`, `peakRssBytes`, `status`) or a key of `result.metrics`. */
	metric: string;
	min?: number;
	max?: number;
	equals?: string | number | boolean;
};

const MIB = 1024 * 1024;

export const BUDGETS: BudgetCheck[] = [
	{ scenario: "startup-version", metric: "directExitCode", equals: 0 },
	{ scenario: "startup-version", metric: "directWallMs", max: 2000 },

	{ scenario: "module-load", metric: "loadedSdkPackages", equals: "(none)" },
	{ scenario: "module-load", metric: "peakRssBytes", max: 96 * MIB },
	{ scenario: "module-load", metric: "wallMs", max: 2000 },

	{ scenario: "cc-synthetic-list-projects", metric: "peakRssBytes", max: 96 * MIB },
	{ scenario: "cc-synthetic-list-projects", metric: "coldMs", max: 2000 },
	{ scenario: "cc-synthetic-list-projects", metric: "coldCount", min: 200 },

	{ scenario: "cc-synthetic-list-sessions", metric: "peakRssBytes", max: 1600 * MIB },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldMs", max: 8000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "warmMs", max: 500 },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldCount", min: 4000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "transcriptMatch", equals: true },

	{ scenario: "stream-throughput", metric: "c1_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c4_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c1_p99Ms", max: 250 },
	{ scenario: "stream-throughput", metric: "c4_p99Ms", max: 300 },
	{ scenario: "stream-throughput", metric: "c1_eventsPerSec", min: 150 },
	{ scenario: "stream-throughput", metric: "c4_eventsPerSec", min: 400 },
	{ scenario: "stream-throughput", metric: "peakRssBytes", max: 448 * MIB },

	{ scenario: "stream-stalled-client", metric: "healthyComplete", equals: true },
	{ scenario: "stream-stalled-client", metric: "healthyKeptStreaming", equals: true },
	{ scenario: "stream-stalled-client", metric: "stalledShed", equals: true },
	{ scenario: "stream-stalled-client", metric: "connectionsAfterShed", max: 1 },
	{ scenario: "stream-stalled-client", metric: "stalledShedAtMs", max: 1000 },
	{ scenario: "stream-stalled-client", metric: "rssGrowthMb", max: 320 },
	{ scenario: "stream-stalled-client", metric: "peakRssBytes", max: 384 * MIB },

	{ scenario: "server-idle", metric: "homeHonorsEnv", equals: true },
	{ scenario: "server-idle", metric: "broskiDirCreated", equals: false },
	{ scenario: "server-idle", metric: "maxChildProcesses", max: 0 },
	{ scenario: "server-idle", metric: "peakSelfRssBytes", max: 256 * MIB },
	{ scenario: "server-idle", metric: "rssDeltaBytes", max: 32 * MIB },
	{ scenario: "server-idle", metric: "cpuPercent", max: 5 },
	{ scenario: "server-idle", metric: "loadedSdkPackagesAfterServer", equals: "(none)" },

	{ scenario: "soak-sessions", metric: "peakRssBytes", max: 256 * MIB },
	{ scenario: "soak-sessions", metric: "rssDeltaBytes", max: 32 * MIB },
	{ scenario: "soak-sessions", metric: "cpuMs", max: 4000 },
	{ scenario: "soak-sessions", metric: "views", min: 50 },
	{ scenario: "soak-sessions", metric: "statusReplies", min: 1 },
];
