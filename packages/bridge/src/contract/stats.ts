import { z } from "zod";
import { Timestamp } from "./ids";
import {
	MAX_ID_CHARS,
	MAX_NAME_CHARS,
	MAX_STATS_MODELS,
	MAX_STATS_PROJECTS,
	MAX_STATS_SERIES,
	MAX_STATS_SOURCES,
	MAX_STATS_SUBAGENTS,
	MAX_STATS_UNPRICED_MODELS,
} from "./limits";
import { Rejected } from "./rejection";

export const StatsRange = z.enum(["day", "week", "month", "quarter", "year", "all"]);
export type StatsRange = z.infer<typeof StatsRange>;

export const StatsResolution = z.enum(["hour", "day"]);
export type StatsResolution = z.infer<typeof StatsResolution>;

export const StatsHarness = z.enum(["pi", "claude", "codex", "opencode", "antigravity", "grok", "gemini"]);
export type StatsHarness = z.infer<typeof StatsHarness>;

export const StatsScanState = z.enum(["fresh", "refreshing", "indexing"]);
export type StatsScanState = z.infer<typeof StatsScanState>;

export const StatsPricingStatus = z.enum(["fresh", "cached", "bundled"]);
export type StatsPricingStatus = z.infer<typeof StatsPricingStatus>;

export const StatsCostSource = z.enum(["provider_reported", "api_estimate", "mixed", "unpriced"]);
export type StatsCostSource = z.infer<typeof StatsCostSource>;

/** Disjoint prompt/output channels; `reasoning` is a tracked subset of `output` and never added to totals. */
export const StatsTokenTotals = z.strictObject({
	uncachedInput: z.int().nonnegative(),
	cachedInput: z.int().nonnegative(),
	cacheCreation: z.int().nonnegative(),
	cacheCreation1h: z.int().nonnegative(),
	output: z.int().nonnegative(),
	reasoning: z.int().nonnegative(),
});
export type StatsTokenTotals = z.infer<typeof StatsTokenTotals>;

export const StatsCostParts = z.strictObject({
	input: z.number().nonnegative(),
	output: z.number().nonnegative(),
	cacheRead: z.number().nonnegative(),
	cacheWrite: z.number().nonnegative(),
	total: z.number().nonnegative(),
});
export type StatsCostParts = z.infer<typeof StatsCostParts>;

export const StatsSpeedCost = z.strictObject({
	standard: z.number().nonnegative(),
	fast: z.number().nonnegative(),
	ultrafast: z.number().nonnegative(),
	premium: z.number().nonnegative(),
});
export type StatsSpeedCost = z.infer<typeof StatsSpeedCost>;

export const StatsTotals = z.strictObject({
	tokens: StatsTokenTotals,
	cost: StatsCostParts,
	speedCost: StatsSpeedCost,
	cacheSavingsUsd: z.number().nonnegative(),
	sessions: z.int().nonnegative(),
	turns: z.int().nonnegative(),
	activeDays: z.int().nonnegative(),
	activeMs: z.int().nonnegative(),
	busts: z.int().nonnegative(),
	idleBusts: z.int().nonnegative(),
	bustCostUsd: z.number().nonnegative(),
	unpricedTurns: z.int().nonnegative(),
	unpricedTokens: z.int().nonnegative(),
	costSource: StatsCostSource,
});
export type StatsTotals = z.infer<typeof StatsTotals>;

export const StatsHarnessEntry = z.strictObject({
	harness: StatsHarness,
	displayName: z.string().min(1).max(MAX_NAME_CHARS),
	sessions: z.int().nonnegative(),
	turns: z.int().nonnegative(),
	tokens: StatsTokenTotals,
	costUsd: z.number().nonnegative(),
	cacheSavingsUsd: z.number().nonnegative(),
	unpricedTurns: z.int().nonnegative(),
});
export type StatsHarnessEntry = z.infer<typeof StatsHarnessEntry>;

export const StatsModelEntry = z.strictObject({
	model: z.string().min(1).max(MAX_NAME_CHARS),
	provider: z.string().min(1).max(MAX_NAME_CHARS),
	harnesses: z.array(StatsHarness).max(MAX_STATS_SOURCES),
	turns: z.int().nonnegative(),
	tokens: StatsTokenTotals,
	cost: StatsCostParts,
	cacheSavingsUsd: z.number().nonnegative(),
	durationMs: z.int().nonnegative(),
	timedOutputTokens: z.int().nonnegative(),
	errors: z.int().nonnegative(),
	unpricedTurns: z.int().nonnegative(),
});
export type StatsModelEntry = z.infer<typeof StatsModelEntry>;

export const StatsProjectEntry = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	name: z.string().min(1).max(MAX_NAME_CHARS),
	harnesses: z.array(StatsHarness).max(MAX_STATS_SOURCES),
	sessions: z.int().nonnegative(),
	turns: z.int().nonnegative(),
	totalTokens: z.int().nonnegative(),
	costUsd: z.number().nonnegative(),
	lastAt: Timestamp,
});
export type StatsProjectEntry = z.infer<typeof StatsProjectEntry>;

export const StatsSubagentEntry = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	harnesses: z.array(StatsHarness).max(MAX_STATS_SOURCES),
	runs: z.int().nonnegative(),
	turns: z.int().nonnegative(),
	totalTokens: z.int().nonnegative(),
	costUsd: z.number().nonnegative(),
	failures: z.int().nonnegative(),
});
export type StatsSubagentEntry = z.infer<typeof StatsSubagentEntry>;

export const StatsSeriesSlice = z.strictObject({
	harness: StatsHarness,
	costUsd: z.number().nonnegative(),
	totalTokens: z.int().nonnegative(),
	turns: z.int().nonnegative(),
});
export type StatsSeriesSlice = z.infer<typeof StatsSeriesSlice>;

export const StatsSeriesPoint = z.strictObject({
	key: z.string().min(1).max(64),
	label: z.string().min(1).max(64),
	costUsd: z.number().nonnegative(),
	totalTokens: z.int().nonnegative(),
	turns: z.int().nonnegative(),
	cacheRead: z.int().nonnegative(),
	cacheDenom: z.int().nonnegative(),
	byHarness: z.array(StatsSeriesSlice).max(MAX_STATS_SOURCES),
});
export type StatsSeriesPoint = z.infer<typeof StatsSeriesPoint>;

export const StatsSourceStatus = z.strictObject({
	harness: StatsHarness,
	state: StatsScanState,
	files: z.int().nonnegative(),
	parsedFiles: z.int().nonnegative(),
	bytesRead: z.int().nonnegative(),
	totalBytes: z.int().nonnegative(),
	problem: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type StatsSourceStatus = z.infer<typeof StatsSourceStatus>;

export const StatsPricingInfo = z.strictObject({
	status: StatsPricingStatus,
	fetchedAt: Timestamp.optional(),
	knownModels: z.int().nonnegative(),
	unpricedModels: z.array(z.string().min(1).max(MAX_NAME_CHARS)).max(MAX_STATS_UNPRICED_MODELS),
});
export type StatsPricingInfo = z.infer<typeof StatsPricingInfo>;

export const StatsFingerprint = z.strictObject({
	hostId: z.string().min(1).max(MAX_ID_CHARS),
	volumeId: z.string().min(1).max(MAX_ID_CHARS),
});
export type StatsFingerprint = z.infer<typeof StatsFingerprint>;

export const StatsSummary = z.strictObject({
	status: z.literal("accepted"),
	generatedAt: Timestamp,
	range: StatsRange,
	resolution: StatsResolution,
	timeZone: z.string().min(1).max(128),
	sinceDay: z.string().min(1).max(32),
	untilDay: z.string().min(1).max(32),
	scanState: StatsScanState,
	fingerprint: StatsFingerprint,
	totals: StatsTotals,
	previousTotals: StatsTotals.optional(),
	harnesses: z.array(StatsHarnessEntry).max(MAX_STATS_SOURCES),
	models: z.array(StatsModelEntry).max(MAX_STATS_MODELS),
	projects: z.array(StatsProjectEntry).max(MAX_STATS_PROJECTS),
	subagents: z.array(StatsSubagentEntry).max(MAX_STATS_SUBAGENTS),
	series: z.array(StatsSeriesPoint).max(MAX_STATS_SERIES),
	sources: z.array(StatsSourceStatus).max(MAX_STATS_SOURCES),
	pricing: StatsPricingInfo,
});
export type StatsSummary = z.infer<typeof StatsSummary>;

export const StatsSummaryResult = z.discriminatedUnion("status", [StatsSummary, Rejected]);
export type StatsSummaryResult = z.infer<typeof StatsSummaryResult>;
