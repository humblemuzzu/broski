/**
 * Perf budgets for the synthetic bench subsection CI runs, applied by `bench/check-budget.ts`.
 * `bench/BUDGETS.md` records the measured values the bounds are based on.
 *
 * Capacity and behaviour gates (bytes, counts, coalescing ratio, flags) are judged on the worst of
 * the CI runs and sit ~2x the worst measured value. Time gates carry `gate: "median"`: CI runs the
 * subset three times, the bound applies to the median, and it sits ~10x the measured median, so it
 * catches an order-of-magnitude regression only.
 */

export type BudgetCheck = {
	scenario: string;
	/** A `ScenarioResult` field (`wallMs`, `peakRssBytes`, `status`) or a key of `result.metrics`. */
	metric: string;
	min?: number;
	max?: number;
	equals?: string | number | boolean;
	/** `median` judges the bound on the median of the runs; default `worst` fails if any run breaks it. */
	gate?: "median" | "worst";
};

const MIB = 1024 * 1024;

export const BUDGETS: BudgetCheck[] = [
	{ scenario: "startup-version", metric: "directExitCode", equals: 0 },
	{ scenario: "startup-version", metric: "directWallMs", max: 2000, gate: "median" },

	{ scenario: "module-load", metric: "loadedSdkPackages", equals: "(none)" },
	{ scenario: "module-load", metric: "peakRssBytes", max: 96 * MIB },
	{ scenario: "module-load", metric: "wallMs", max: 2000, gate: "median" },

	{ scenario: "cc-synthetic-list-projects", metric: "peakRssBytes", max: 96 * MIB },
	{ scenario: "cc-synthetic-list-projects", metric: "coldMs", max: 2000, gate: "median" },
	{ scenario: "cc-synthetic-list-projects", metric: "coldCount", min: 200 },

	{ scenario: "cc-synthetic-list-sessions", metric: "peakRssBytes", max: 1600 * MIB },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldMs", max: 8000, gate: "median" },
	{ scenario: "cc-synthetic-list-sessions", metric: "warmMs", max: 500, gate: "median" },
	{ scenario: "cc-synthetic-list-sessions", metric: "coldCount", min: 4000 },
	{ scenario: "cc-synthetic-list-sessions", metric: "transcriptMatch", equals: true },

	// 20 000 deltas must arrive, merged into few events and few frames: coalescing off -> 20 000
	// events at 120 chars, send-queue batching off -> 73 frames, one per merged event.
	{ scenario: "stream-throughput", metric: "c1_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c4_charsMin", min: 2_400_000 },
	{ scenario: "stream-throughput", metric: "c1_eventsMax", max: 400 },
	{ scenario: "stream-throughput", metric: "c4_eventsMax", max: 400 },
	{ scenario: "stream-throughput", metric: "c1_framesMax", max: 48 },
	{ scenario: "stream-throughput", metric: "c4_framesMax", max: 48 },
	{ scenario: "stream-throughput", metric: "c1_charsPerEventMin", min: 4000 },
	{ scenario: "stream-throughput", metric: "c4_charsPerEventMin", min: 4000 },
	{ scenario: "stream-throughput", metric: "c1_wireBytesMax", max: 3_200_000 },
	{ scenario: "stream-throughput", metric: "c4_wireBytesMax", max: 3_200_000 },
	{ scenario: "stream-throughput", metric: "peakRssBytes", max: 448 * MIB },

	{ scenario: "stream-throughput", metric: "c1_p50Ms", max: 500, gate: "median" },
	{ scenario: "stream-throughput", metric: "c4_p50Ms", max: 500, gate: "median" },
	{ scenario: "stream-throughput", metric: "c1_p99Ms", max: 1000, gate: "median" },
	{ scenario: "stream-throughput", metric: "c4_p99Ms", max: 1000, gate: "median" },
	{ scenario: "stream-throughput", metric: "c1_eventsPerSec", min: 150, gate: "median" },
	{ scenario: "stream-throughput", metric: "c4_eventsPerSec", min: 400, gate: "median" },

	{ scenario: "stream-stalled-client", metric: "healthyComplete", equals: true },
	{ scenario: "stream-stalled-client", metric: "healthyKeptStreaming", equals: true },
	{ scenario: "stream-stalled-client", metric: "stalledShed", equals: true },
	{ scenario: "stream-stalled-client", metric: "connectionsAfterShed", max: 1 },
	{ scenario: "stream-stalled-client", metric: "rssGrowthMb", max: 320 },
	{ scenario: "stream-stalled-client", metric: "peakRssBytes", max: 384 * MIB },
	{ scenario: "stream-stalled-client", metric: "stalledShedAtMs", max: 2000, gate: "median" },

	{ scenario: "server-idle", metric: "homeHonorsEnv", equals: true },
	{ scenario: "server-idle", metric: "broskiDirCreated", equals: false },
	{ scenario: "server-idle", metric: "maxChildProcesses", max: 0 },
	{ scenario: "server-idle", metric: "peakSelfRssBytes", max: 256 * MIB },
	{ scenario: "server-idle", metric: "rssDeltaBytes", max: 32 * MIB },
	{ scenario: "server-idle", metric: "loadedSdkPackagesAfterServer", equals: "(none)" },
	{ scenario: "server-idle", metric: "cpuPercent", max: 5, gate: "median" },

	{ scenario: "soak-sessions", metric: "peakRssBytes", max: 256 * MIB },
	{ scenario: "soak-sessions", metric: "rssDeltaBytes", max: 32 * MIB },
	{ scenario: "soak-sessions", metric: "views", min: 50 },
	{ scenario: "soak-sessions", metric: "statusReplies", min: 1 },
	{ scenario: "soak-sessions", metric: "cpuMs", max: 4000, gate: "median" },

	// One idle PTY used to block the JS thread for 121 ms per reader iteration, 605 ms with five
	// sessions; this runs three and bounds the yield p99 at 10 ms, well under a single stall. The
	// counters are the deterministic half: sessions must be alive and the echo must come back, so a
	// quiet thread with a dead reader cannot pass on timing alone.
	{ scenario: "pty-main-thread-stall", metric: "idleSessions", min: 3 },
	{ scenario: "pty-main-thread-stall", metric: "idleSessionsRunning", min: 3 },
	{ scenario: "pty-main-thread-stall", metric: "yieldSamples", min: 25 },
	{ scenario: "pty-main-thread-stall", metric: "echoSamples", min: 5 },
	{ scenario: "pty-main-thread-stall", metric: "idleStallP99Ms", max: 10, gate: "median" },
	{ scenario: "pty-main-thread-stall", metric: "echoP50Ms", max: 30, gate: "median" },
	{ scenario: "pty-main-thread-stall", metric: "peakRssBytes", max: 256 * MIB },
];
