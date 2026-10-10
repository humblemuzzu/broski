/**
 * Perf budgets for the synthetic bench subsection CI runs, applied by `bench/check-budget.ts`.
 * `bench/BUDGETS.md` records the measured values the bounds are based on.
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
	{ scenario: "module-load", metric: "loadedSdkPackages", equals: "(none)" },
	{ scenario: "module-load", metric: "peakRssBytes", max: 128 * MIB },
	{ scenario: "module-load", metric: "wallMs", max: 5000 },

	{ scenario: "cc-synthetic-list-projects", metric: "peakRssBytes", max: 256 * MIB },
	{ scenario: "cc-synthetic-list-projects", metric: "coldMs", max: 5000 },
	{ scenario: "cc-synthetic-list-projects", metric: "coldCount", min: 200 },

	{ scenario: "cc-synthetic-list-sessions", metric: "peakRssBytes", max: 1600 * MIB },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldMs", max: 20_000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "warmMs", max: 6000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldCount", min: 4000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "transcriptMatch", equals: true },

	{ scenario: "stream-throughput", metric: "c1_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c4_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c1_p99Ms", max: 400 },
	{ scenario: "stream-throughput", metric: "c4_p99Ms", max: 500 },
	{ scenario: "stream-throughput", metric: "c1_eventsPerSec", min: 150 },
	{ scenario: "stream-throughput", metric: "c4_eventsPerSec", min: 400 },
	{ scenario: "stream-throughput", metric: "peakRssBytes", max: 512 * MIB },

	{ scenario: "stream-stalled-client", metric: "healthyComplete", equals: true },
	{ scenario: "stream-stalled-client", metric: "healthyKeptStreaming", equals: true },
	{ scenario: "stream-stalled-client", metric: "stalledShed", equals: true },
	{ scenario: "stream-stalled-client", metric: "connectionsAfterShed", max: 1 },
	{ scenario: "stream-stalled-client", metric: "stalledShedAtMs", max: 5000 },
	{ scenario: "stream-stalled-client", metric: "rssGrowthMb", max: 700 },
	{ scenario: "stream-stalled-client", metric: "peakRssBytes", max: 900 * MIB },

	{ scenario: "server-idle", metric: "homeHonorsEnv", equals: true },
	{ scenario: "server-idle", metric: "broskiDirCreated", equals: false },
	{ scenario: "server-idle", metric: "maxChildProcesses", max: 0 },
	{ scenario: "server-idle", metric: "peakSelfRssBytes", max: 400 * MIB },
	{ scenario: "server-idle", metric: "rssDeltaBytes", max: 64 * MIB },
	{ scenario: "server-idle", metric: "cpuPercent", max: 10 },
	{ scenario: "server-idle", metric: "loadedSdkPackagesAfterServer", equals: "(none)" },

	{ scenario: "soak-sessions", metric: "peakRssBytes", max: 400 * MIB },
	{ scenario: "soak-sessions", metric: "rssDeltaBytes", max: 64 * MIB },
	{ scenario: "soak-sessions", metric: "cpuMs", max: 8000 },
	{ scenario: "soak-sessions", metric: "views", min: 50 },
	{ scenario: "soak-sessions", metric: "statusReplies", min: 1 },
];
