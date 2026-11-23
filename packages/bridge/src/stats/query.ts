import type {
	StatsCostSource,
	StatsHarness,
	StatsHarnessEntry,
	StatsModelEntry,
	StatsProjectEntry,
	StatsRange,
	StatsResolution,
	StatsScanState,
	StatsSeriesPoint,
	StatsSeriesSlice,
	StatsSourceStatus,
	StatsSubagentEntry,
	StatsSummary,
	StatsTokenTotals,
	StatsTotals,
} from "../contract";
import {
	MAX_ID_CHARS,
	MAX_NAME_CHARS,
	MAX_STATS_MODELS,
	MAX_STATS_PROJECTS,
	MAX_STATS_SERIES,
	MAX_STATS_SUBAGENTS,
	MAX_STATS_UNPRICED_MODELS,
} from "../contract";
import { clip } from "../contract/clip";
import type { PriceBook } from "./pricing";
import type { StatsStore } from "./store";
import { HARNESS_DISPLAY_NAME, HARNESSES, localDayKey, type SourceProgress, utcHourKey } from "./types";

const RANGE_DAYS: Readonly<Record<StatsRange, number>> = {
	day: 1,
	week: 7,
	month: 30,
	quarter: 90,
	year: 365,
	all: 0,
};

interface AggRow {
	turns: number;
	uncached_input: number;
	cached_input: number;
	cache_write: number;
	cache_write_1h: number;
	output: number;
	reasoning: number;
	cost_input: number;
	cost_output: number;
	cost_cache_read: number;
	cost_cache_write: number;
	cost_total: number;
	speed_premium: number;
	cache_savings: number;
	duration_ms: number;
	timed_output: number;
	errors: number;
	busts: number;
	idle_busts: number;
	bust_cost: number;
	unpriced_turns: number;
	unpriced_tokens: number;
	fast_cost: number;
	ultrafast_cost: number;
	standard_cost: number;
	reported_turns: number;
	estimated_turns: number;
}

export interface QueryInput {
	readonly range: StatsRange;
	readonly harness?: StatsHarness;
	readonly timeZone?: string;
	readonly now?: number;
	readonly scanState: StatsScanState;
	readonly sources: ReadonlyMap<StatsHarness, SourceProgress>;
	readonly anchorPath: string;
}

export function querySummary(store: StatsStore, priceBook: PriceBook, input: QueryInput): StatsSummary {
	const now = input.now ?? Date.now();
	const timeZone = validTimeZone(input.timeZone);
	// The store keys day buckets in this machine's zone, so the day window must be cut in it too.
	const today = localDayKey(now);
	const resolution: StatsResolution = input.range === "day" ? "hour" : "day";

	const window = computeWindow(store, input.range, today, now);
	const totals =
		resolution === "hour"
			? queryHourlyTotals(store, window.sinceHour, window.untilHour, input.harness)
			: queryDailyTotals(store, window.sinceDay, window.untilDay, input.harness);
	const previousTotals =
		input.range === "all"
			? undefined
			: resolution === "hour"
				? queryHourlyTotals(store, window.prevSinceHour, window.prevUntilHour, input.harness)
				: queryDailyTotals(store, window.prevSinceDay, window.prevUntilDay, input.harness);

	const harnesses =
		resolution === "hour"
			? queryHarnessesHourly(store, window.sinceHour, window.untilHour, input.harness)
			: queryHarnessesDaily(store, window.sinceDay, window.untilDay, input.harness);
	const models =
		resolution === "hour"
			? queryModelsHourly(store, window.sinceHour, window.untilHour, input.harness)
			: queryModelsDaily(store, window.sinceDay, window.untilDay, input.harness);
	const projectSince = resolution === "hour" ? addDays(window.untilDay, -1) : window.sinceDay;
	const projects = queryProjects(store, projectSince, window.untilDay, input.harness);
	const subagents = querySubagents(store, projectSince, window.untilDay, input.harness);
	const series =
		resolution === "hour"
			? queryHourlySeries(store, window.hourKeys, timeZone, input.harness)
			: queryDailySeries(store, window.sinceDay, window.untilDay, input.harness);
	const unpricedModels = queryUnpricedModels(store, window.sinceDay, window.untilDay, input.harness);
	const sources = buildSourceStatuses(input.sources);
	const priceInfo = priceBook.info();

	return {
		status: "accepted",
		generatedAt: Math.trunc(now),
		range: input.range,
		resolution,
		timeZone,
		sinceDay: window.sinceDay,
		untilDay: window.untilDay,
		scanState: input.scanState,
		fingerprint: store.fingerprint(input.anchorPath),
		totals,
		...(previousTotals !== undefined && { previousTotals }),
		harnesses,
		models,
		projects,
		subagents,
		series,
		sources,
		pricing: {
			status: priceInfo.status,
			...(priceInfo.fetchedAt !== undefined && { fetchedAt: Math.trunc(priceInfo.fetchedAt) }),
			knownModels: priceInfo.knownModels,
			unpricedModels,
		},
	};
}

function computeWindow(store: StatsStore, range: StatsRange, today: string, now: number) {
	const days = RANGE_DAYS[range];
	let sinceDay: string;
	if (days === 0) {
		const row = store.db.query<{ first_day: string | null }, []>("SELECT MIN(day) AS first_day FROM turns_daily").get();
		sinceDay = row?.first_day ?? today;
	} else {
		sinceDay = addDays(today, -(days - 1));
	}
	const prevUntilDay = addDays(sinceDay, -1);
	const prevSinceDay = days > 0 ? addDays(prevUntilDay, -(days - 1)) : sinceDay;

	const currentHourStart = Math.floor(now / 3_600_000) * 3_600_000;
	const hourKeys: string[] = [];
	for (let i = 23; i >= 0; i--) hourKeys.push(utcHourKey(currentHourStart - i * 3_600_000));
	const sinceHour = hourKeys[0] ?? utcHourKey(currentHourStart);
	const untilHour = hourKeys[hourKeys.length - 1] ?? utcHourKey(currentHourStart);
	const prevSinceHour = utcHourKey(currentHourStart - 47 * 3_600_000);
	const prevUntilHour = utcHourKey(currentHourStart - 24 * 3_600_000);
	return {
		sinceDay,
		untilDay: today,
		prevSinceDay,
		prevUntilDay,
		sinceHour,
		untilHour,
		prevSinceHour,
		prevUntilHour,
		hourKeys,
	};
}

function queryDailyTotals(store: StatsStore, sinceDay: string, untilDay: string, harness?: StatsHarness): StatsTotals {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceDay, untilDay, harness] : [sinceDay, untilDay];
	const row = store.db
		.query<AggRow, string[]>(
			`SELECT
				COALESCE(SUM(turns), 0) AS turns,
				COALESCE(SUM(uncached_input), 0) AS uncached_input,
				COALESCE(SUM(cached_input), 0) AS cached_input,
				COALESCE(SUM(cache_write), 0) AS cache_write,
				COALESCE(SUM(cache_write_1h), 0) AS cache_write_1h,
				COALESCE(SUM(output), 0) AS output,
				COALESCE(SUM(reasoning), 0) AS reasoning,
				COALESCE(SUM(cost_input), 0) AS cost_input,
				COALESCE(SUM(cost_output), 0) AS cost_output,
				COALESCE(SUM(cost_cache_read), 0) AS cost_cache_read,
				COALESCE(SUM(cost_cache_write), 0) AS cost_cache_write,
				COALESCE(SUM(cost_total), 0) AS cost_total,
				COALESCE(SUM(speed_premium), 0) AS speed_premium,
				COALESCE(SUM(cache_savings), 0) AS cache_savings,
				COALESCE(SUM(duration_ms), 0) AS duration_ms,
				COALESCE(SUM(timed_output), 0) AS timed_output,
				COALESCE(SUM(errors), 0) AS errors,
				COALESCE(SUM(busts), 0) AS busts,
				COALESCE(SUM(idle_busts), 0) AS idle_busts,
				COALESCE(SUM(bust_cost), 0) AS bust_cost,
				COALESCE(SUM(unpriced_turns), 0) AS unpriced_turns,
				COALESCE(SUM(unpriced_tokens), 0) AS unpriced_tokens,
				COALESCE(SUM(CASE WHEN speed_tier = 'fast' THEN cost_total ELSE 0 END), 0) AS fast_cost,
				COALESCE(SUM(CASE WHEN speed_tier = 'ultrafast' THEN cost_total ELSE 0 END), 0) AS ultrafast_cost,
				COALESCE(SUM(CASE WHEN speed_tier NOT IN ('fast', 'ultrafast') THEN cost_total ELSE 0 END), 0) AS standard_cost,
				COALESCE(SUM(CASE WHEN cost_source = 'provider_reported' THEN turns ELSE 0 END), 0) AS reported_turns,
				COALESCE(SUM(CASE WHEN cost_source = 'api_estimate' THEN turns ELSE 0 END), 0) AS estimated_turns
			 FROM turns_daily WHERE day >= ? AND day <= ?${filter}`,
		)
		.get(...args);

	const activeDaysRow = store.db
		.query<{ n: number }, string[]>(
			`SELECT COUNT(DISTINCT day) AS n FROM turns_daily WHERE day >= ? AND day <= ? AND (turns > 0 OR output > 0 OR cached_input > 0)${filter}`,
		)
		.get(...args);
	const sessRow = store.db
		.query<{ n: number; ms: number }, string[]>(
			`SELECT COUNT(DISTINCT session_key) AS n, COALESCE(SUM(active_ms), 0) AS ms
			 FROM session_days WHERE day >= ? AND day <= ?${filter}`,
		)
		.get(...args);

	return buildTotals(row, sessRow?.n ?? 0, activeDaysRow?.n ?? 0, sessRow?.ms ?? 0);
}

function queryHourlyTotals(
	store: StatsStore,
	sinceHour: string,
	untilHour: string,
	harness?: StatsHarness,
): StatsTotals {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceHour, untilHour, harness] : [sinceHour, untilHour];
	const row = store.db
		.query<AggRow, string[]>(
			`SELECT
				COALESCE(SUM(turns), 0) AS turns,
				COALESCE(SUM(uncached_input), 0) AS uncached_input,
				COALESCE(SUM(cached_input), 0) AS cached_input,
				COALESCE(SUM(cache_write), 0) AS cache_write,
				COALESCE(SUM(cache_write_1h), 0) AS cache_write_1h,
				COALESCE(SUM(output), 0) AS output,
				COALESCE(SUM(reasoning), 0) AS reasoning,
				COALESCE(SUM(cost_input), 0) AS cost_input,
				COALESCE(SUM(cost_output), 0) AS cost_output,
				COALESCE(SUM(cost_cache_read), 0) AS cost_cache_read,
				COALESCE(SUM(cost_cache_write), 0) AS cost_cache_write,
				COALESCE(SUM(cost_total), 0) AS cost_total,
				COALESCE(SUM(speed_premium), 0) AS speed_premium,
				COALESCE(SUM(cache_savings), 0) AS cache_savings,
				COALESCE(SUM(duration_ms), 0) AS duration_ms,
				COALESCE(SUM(timed_output), 0) AS timed_output,
				COALESCE(SUM(errors), 0) AS errors,
				0 AS busts, 0 AS idle_busts, 0 AS bust_cost,
				COALESCE(SUM(unpriced_turns), 0) AS unpriced_turns,
				COALESCE(SUM(unpriced_tokens), 0) AS unpriced_tokens,
				COALESCE(SUM(CASE WHEN speed_tier = 'fast' THEN cost_total ELSE 0 END), 0) AS fast_cost,
				COALESCE(SUM(CASE WHEN speed_tier = 'ultrafast' THEN cost_total ELSE 0 END), 0) AS ultrafast_cost,
				COALESCE(SUM(CASE WHEN speed_tier NOT IN ('fast', 'ultrafast') THEN cost_total ELSE 0 END), 0) AS standard_cost,
				COALESCE(SUM(CASE WHEN cost_source = 'provider_reported' THEN turns ELSE 0 END), 0) AS reported_turns,
				COALESCE(SUM(CASE WHEN cost_source = 'api_estimate' THEN turns ELSE 0 END), 0) AS estimated_turns
			 FROM turns_hourly WHERE hour_key >= ? AND hour_key <= ?${filter}`,
		)
		.get(...args);

	const sessRow = store.db
		.query<{ n: number; ms: number }, string[]>(
			`SELECT COUNT(DISTINCT session_key) AS n, COALESCE(SUM(active_ms), 0) AS ms
			 FROM session_days WHERE hour_key >= ? AND hour_key <= ?${filter}`,
		)
		.get(...args);
	const activeDays = row && (row.turns > 0 || row.output > 0) ? 1 : 0;
	return buildTotals(row, sessRow?.n ?? 0, activeDays, sessRow?.ms ?? 0);
}

function buildTotals(row: AggRow | null, sessions: number, activeDays: number, activeMs: number): StatsTotals {
	const r = row;
	const tokens: StatsTokenTotals = {
		uncachedInput: int0(r?.uncached_input),
		cachedInput: int0(r?.cached_input),
		cacheCreation: int0(r?.cache_write),
		cacheCreation1h: int0(r?.cache_write_1h),
		output: int0(r?.output),
		reasoning: int0(r?.reasoning),
	};
	const costSource = classifyCostSource(r?.reported_turns ?? 0, r?.estimated_turns ?? 0, r?.unpriced_turns ?? 0);
	return {
		tokens,
		cost: {
			input: nonNeg(r?.cost_input),
			output: nonNeg(r?.cost_output),
			cacheRead: nonNeg(r?.cost_cache_read),
			cacheWrite: nonNeg(r?.cost_cache_write),
			total: nonNeg(r?.cost_total),
		},
		speedCost: {
			standard: nonNeg(r?.standard_cost),
			fast: nonNeg(r?.fast_cost),
			ultrafast: nonNeg(r?.ultrafast_cost),
			premium: nonNeg(r?.speed_premium),
		},
		cacheSavingsUsd: nonNeg(r?.cache_savings),
		sessions: int0(sessions),
		turns: int0(r?.turns),
		activeDays: int0(activeDays),
		activeMs: int0(activeMs),
		busts: int0(r?.busts),
		idleBusts: int0(r?.idle_busts),
		bustCostUsd: nonNeg(r?.bust_cost),
		unpricedTurns: int0(r?.unpriced_turns),
		unpricedTokens: int0(r?.unpriced_tokens),
		costSource,
	};
}

function queryHarnessesDaily(
	store: StatsStore,
	sinceDay: string,
	untilDay: string,
	harness?: StatsHarness,
): StatsHarnessEntry[] {
	return queryHarnesses(store, "turns_daily", "day", sinceDay, untilDay, harness);
}

function queryHarnessesHourly(
	store: StatsStore,
	sinceHour: string,
	untilHour: string,
	harness?: StatsHarness,
): StatsHarnessEntry[] {
	return queryHarnesses(store, "turns_hourly", "hour_key", sinceHour, untilHour, harness);
}

function queryHarnesses(
	store: StatsStore,
	table: "turns_daily" | "turns_hourly",
	col: "day" | "hour_key",
	from: string,
	to: string,
	harness?: StatsHarness,
): StatsHarnessEntry[] {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [from, to, harness] : [from, to];
	const rows = store.db
		.query<
			{
				harness: StatsHarness;
				turns: number;
				uncached_input: number;
				cached_input: number;
				cache_write: number;
				cache_write_1h: number;
				output: number;
				reasoning: number;
				cost_total: number;
				cache_savings: number;
				unpriced_turns: number;
			},
			string[]
		>(
			`SELECT harness,
				SUM(turns) AS turns, SUM(uncached_input) AS uncached_input, SUM(cached_input) AS cached_input,
				SUM(cache_write) AS cache_write, SUM(cache_write_1h) AS cache_write_1h, SUM(output) AS output,
				SUM(reasoning) AS reasoning, SUM(cost_total) AS cost_total, SUM(cache_savings) AS cache_savings,
				SUM(unpriced_turns) AS unpriced_turns
			 FROM ${table} WHERE ${col} >= ? AND ${col} <= ?${filter}
			 GROUP BY harness ORDER BY cost_total DESC, (uncached_input + cached_input + cache_write + output) DESC`,
		)
		.all(...args);

	const sessRows = store.db
		.query<{ harness: StatsHarness; n: number }, string[]>(
			`SELECT harness, COUNT(DISTINCT session_key) AS n FROM session_days WHERE ${col} >= ? AND ${col} <= ?${filter} GROUP BY harness`,
		)
		.all(...args);
	const sessMap = new Map(sessRows.map((r) => [r.harness, r.n]));

	return rows.map((r) => ({
		harness: r.harness,
		displayName: HARNESS_DISPLAY_NAME[r.harness] ?? r.harness,
		sessions: int0(sessMap.get(r.harness)),
		turns: int0(r.turns),
		tokens: {
			uncachedInput: int0(r.uncached_input),
			cachedInput: int0(r.cached_input),
			cacheCreation: int0(r.cache_write),
			cacheCreation1h: int0(r.cache_write_1h),
			output: int0(r.output),
			reasoning: int0(r.reasoning),
		},
		costUsd: nonNeg(r.cost_total),
		cacheSavingsUsd: nonNeg(r.cache_savings),
		unpricedTurns: int0(r.unpriced_turns),
	}));
}

function queryModelsDaily(
	store: StatsStore,
	sinceDay: string,
	untilDay: string,
	harness?: StatsHarness,
): StatsModelEntry[] {
	return queryModels(store, "turns_daily", "day", sinceDay, untilDay, harness);
}

function queryModelsHourly(
	store: StatsStore,
	sinceHour: string,
	untilHour: string,
	harness?: StatsHarness,
): StatsModelEntry[] {
	return queryModels(store, "turns_hourly", "hour_key", sinceHour, untilHour, harness);
}

function queryModels(
	store: StatsStore,
	table: "turns_daily" | "turns_hourly",
	col: "day" | "hour_key",
	from: string,
	to: string,
	harness?: StatsHarness,
): StatsModelEntry[] {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [from, to, harness] : [from, to];
	const rows = store.db
		.query<
			{
				model: string;
				provider: string;
				harnesses: string;
				turns: number;
				uncached_input: number;
				cached_input: number;
				cache_write: number;
				cache_write_1h: number;
				output: number;
				reasoning: number;
				cost_input: number;
				cost_output: number;
				cost_cache_read: number;
				cost_cache_write: number;
				cost_total: number;
				cache_savings: number;
				duration_ms: number;
				timed_output: number;
				errors: number;
				unpriced_turns: number;
			},
			string[]
		>(
			`SELECT model, provider, GROUP_CONCAT(DISTINCT harness) AS harnesses,
				SUM(turns) AS turns, SUM(uncached_input) AS uncached_input, SUM(cached_input) AS cached_input,
				SUM(cache_write) AS cache_write, SUM(cache_write_1h) AS cache_write_1h, SUM(output) AS output,
				SUM(reasoning) AS reasoning, SUM(cost_input) AS cost_input, SUM(cost_output) AS cost_output,
				SUM(cost_cache_read) AS cost_cache_read, SUM(cost_cache_write) AS cost_cache_write,
				SUM(cost_total) AS cost_total, SUM(cache_savings) AS cache_savings,
				SUM(duration_ms) AS duration_ms, SUM(timed_output) AS timed_output,
				SUM(errors) AS errors, SUM(unpriced_turns) AS unpriced_turns
			 FROM ${table} WHERE ${col} >= ? AND ${col} <= ?${filter}
			 GROUP BY provider, model
			 ORDER BY cost_total DESC, (uncached_input + cached_input + cache_write + output) DESC
			 LIMIT ${MAX_STATS_MODELS}`,
		)
		.all(...args);

	return rows.map((r) => ({
		model: clip(r.model || "unknown", MAX_NAME_CHARS),
		provider: clip(r.provider || "unknown", MAX_NAME_CHARS),
		harnesses: parseHarnessList(r.harnesses),
		turns: int0(r.turns),
		tokens: {
			uncachedInput: int0(r.uncached_input),
			cachedInput: int0(r.cached_input),
			cacheCreation: int0(r.cache_write),
			cacheCreation1h: int0(r.cache_write_1h),
			output: int0(r.output),
			reasoning: int0(r.reasoning),
		},
		cost: {
			input: nonNeg(r.cost_input),
			output: nonNeg(r.cost_output),
			cacheRead: nonNeg(r.cost_cache_read),
			cacheWrite: nonNeg(r.cost_cache_write),
			total: nonNeg(r.cost_total),
		},
		cacheSavingsUsd: nonNeg(r.cache_savings),
		durationMs: int0(r.duration_ms),
		timedOutputTokens: int0(r.timed_output),
		errors: int0(r.errors),
		unpricedTurns: int0(r.unpriced_turns),
	}));
}

function queryProjects(
	store: StatsStore,
	sinceDay: string,
	untilDay: string,
	harness?: StatsHarness,
): StatsProjectEntry[] {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceDay, untilDay, harness] : [sinceDay, untilDay];
	const rows = store.db
		.query<
			{
				project_id: string;
				project_name: string;
				harnesses: string;
				turns: number;
				total_tokens: number;
				cost_usd: number;
				last_ms: number;
			},
			string[]
		>(
			`SELECT project_id, MAX(project_name) AS project_name, GROUP_CONCAT(DISTINCT harness) AS harnesses,
				SUM(turns) AS turns, SUM(total_tokens) AS total_tokens, SUM(cost_usd) AS cost_usd, MAX(last_ms) AS last_ms
			 FROM project_daily WHERE day >= ? AND day <= ?${filter}
			 GROUP BY project_id
			 ORDER BY cost_usd DESC, total_tokens DESC
			 LIMIT ${MAX_STATS_PROJECTS}`,
		)
		.all(...args);

	const sessRows = store.db
		.query<{ project_id: string; n: number }, string[]>(
			`SELECT project_id, COUNT(DISTINCT session_key) AS n FROM session_days WHERE day >= ? AND day <= ?${filter} GROUP BY project_id`,
		)
		.all(...args);
	const sessMap = new Map(sessRows.map((r) => [r.project_id, r.n]));

	return rows.map((r) => ({
		id: clip(r.project_id, MAX_ID_CHARS),
		name: clip(r.project_name || "Unknown", MAX_NAME_CHARS),
		harnesses: parseHarnessList(r.harnesses),
		sessions: int0(sessMap.get(r.project_id)),
		turns: int0(r.turns),
		totalTokens: int0(r.total_tokens),
		costUsd: nonNeg(r.cost_usd),
		lastAt: int0(r.last_ms),
	}));
}

function querySubagents(
	store: StatsStore,
	sinceDay: string,
	untilDay: string,
	harness?: StatsHarness,
): StatsSubagentEntry[] {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceDay, untilDay, harness] : [sinceDay, untilDay];
	const rows = store.db
		.query<
			{
				agent_name: string;
				harnesses: string;
				runs: number;
				turns: number;
				total_tokens: number;
				cost_usd: number;
				failures: number;
			},
			string[]
		>(
			`SELECT agent_name, GROUP_CONCAT(DISTINCT harness) AS harnesses,
				SUM(runs) AS runs, SUM(turns) AS turns, SUM(total_tokens) AS total_tokens,
				SUM(cost_usd) AS cost_usd, SUM(failures) AS failures
			 FROM subagents_daily WHERE day >= ? AND day <= ?${filter}
			 GROUP BY agent_name
			 ORDER BY cost_usd DESC, runs DESC
			 LIMIT ${MAX_STATS_SUBAGENTS}`,
		)
		.all(...args);

	return rows.map((r) => ({
		name: clip(r.agent_name || "subagent", MAX_NAME_CHARS),
		harnesses: parseHarnessList(r.harnesses),
		runs: int0(r.runs),
		turns: int0(r.turns),
		totalTokens: int0(r.total_tokens),
		costUsd: nonNeg(r.cost_usd),
		failures: int0(r.failures),
	}));
}

function queryDailySeries(
	store: StatsStore,
	sinceDay: string,
	untilDay: string,
	harness?: StatsHarness,
): StatsSeriesPoint[] {
	const seriesStart = clampSeriesStart(sinceDay, untilDay, MAX_STATS_SERIES);
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [seriesStart, untilDay, harness] : [seriesStart, untilDay];
	const rows = store.db
		.query<
			{
				day: string;
				harness: StatsHarness;
				cost_total: number;
				total_tokens: number;
				turns: number;
				cache_read: number;
				cache_denom: number;
			},
			string[]
		>(
			`SELECT day, harness,
				SUM(cost_total) AS cost_total,
				SUM(uncached_input + cached_input + cache_write + output) AS total_tokens,
				SUM(turns) AS turns,
				SUM(cached_input) AS cache_read,
				SUM(uncached_input + cached_input + cache_write) AS cache_denom
			 FROM turns_daily WHERE day >= ? AND day <= ?${filter}
			 GROUP BY day, harness ORDER BY day ASC`,
		)
		.all(...args);

	const byDay = new Map<string, StatsSeriesPoint>();
	for (let d = seriesStart; d <= untilDay; d = addDays(d, 1)) {
		byDay.set(d, {
			key: d,
			label: shortDayLabel(d),
			costUsd: 0,
			totalTokens: 0,
			turns: 0,
			cacheRead: 0,
			cacheDenom: 0,
			byHarness: [],
		});
		if (byDay.size >= MAX_STATS_SERIES) break;
	}
	for (const r of rows) {
		const point = byDay.get(r.day);
		if (!point) continue;
		const slices: StatsSeriesSlice[] = [
			...point.byHarness,
			{
				harness: r.harness,
				costUsd: nonNeg(r.cost_total),
				totalTokens: int0(r.total_tokens),
				turns: int0(r.turns),
			},
		];
		byDay.set(r.day, {
			...point,
			costUsd: point.costUsd + nonNeg(r.cost_total),
			totalTokens: point.totalTokens + int0(r.total_tokens),
			turns: point.turns + int0(r.turns),
			cacheRead: point.cacheRead + int0(r.cache_read),
			cacheDenom: point.cacheDenom + int0(r.cache_denom),
			byHarness: slices,
		});
	}
	return [...byDay.values()];
}

function queryHourlySeries(
	store: StatsStore,
	hourKeys: readonly string[],
	timeZone: string,
	harness?: StatsHarness,
): StatsSeriesPoint[] {
	const sinceHour = hourKeys[0];
	const untilHour = hourKeys[hourKeys.length - 1];
	if (!sinceHour || !untilHour) return [];
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceHour, untilHour, harness] : [sinceHour, untilHour];
	const rows = store.db
		.query<
			{
				hour_key: string;
				harness: StatsHarness;
				cost_total: number;
				total_tokens: number;
				turns: number;
				cache_read: number;
				cache_denom: number;
			},
			string[]
		>(
			`SELECT hour_key, harness,
				SUM(cost_total) AS cost_total,
				SUM(uncached_input + cached_input + cache_write + output) AS total_tokens,
				SUM(turns) AS turns,
				SUM(cached_input) AS cache_read,
				SUM(uncached_input + cached_input + cache_write) AS cache_denom
			 FROM turns_hourly WHERE hour_key >= ? AND hour_key <= ?${filter}
			 GROUP BY hour_key, harness ORDER BY hour_key ASC`,
		)
		.all(...args);

	const byHour = new Map<string, StatsSeriesPoint>();
	for (const hk of hourKeys) {
		byHour.set(hk, {
			key: hk,
			label: formatHourLabel(hk, timeZone),
			costUsd: 0,
			totalTokens: 0,
			turns: 0,
			cacheRead: 0,
			cacheDenom: 0,
			byHarness: [],
		});
	}
	for (const r of rows) {
		const point = byHour.get(r.hour_key);
		if (!point) continue;
		byHour.set(r.hour_key, {
			...point,
			costUsd: point.costUsd + nonNeg(r.cost_total),
			totalTokens: point.totalTokens + int0(r.total_tokens),
			turns: point.turns + int0(r.turns),
			cacheRead: point.cacheRead + int0(r.cache_read),
			cacheDenom: point.cacheDenom + int0(r.cache_denom),
			byHarness: [
				...point.byHarness,
				{
					harness: r.harness,
					costUsd: nonNeg(r.cost_total),
					totalTokens: int0(r.total_tokens),
					turns: int0(r.turns),
				},
			],
		});
	}
	return [...byHour.values()];
}

function queryUnpricedModels(store: StatsStore, sinceDay: string, untilDay: string, harness?: StatsHarness): string[] {
	const filter = harness ? " AND harness = ?" : "";
	const args = harness ? [sinceDay, untilDay, harness] : [sinceDay, untilDay];
	const rows = store.db
		.query<{ model: string }, string[]>(
			`SELECT DISTINCT model FROM turns_daily WHERE day >= ? AND day <= ? AND unpriced_turns > 0${filter} LIMIT ${MAX_STATS_UNPRICED_MODELS}`,
		)
		.all(...args);
	return rows.map((r) => clip(r.model, MAX_NAME_CHARS)).filter(Boolean);
}

function buildSourceStatuses(progress: ReadonlyMap<StatsHarness, SourceProgress>): StatsSourceStatus[] {
	const out: StatsSourceStatus[] = [];
	for (const h of HARNESSES) {
		const p = progress.get(h);
		if (!p) continue;
		if (p.files === 0 && !p.problem) continue;
		out.push({
			harness: h,
			state: p.state,
			files: int0(p.files),
			parsedFiles: int0(p.parsedFiles),
			bytesRead: int0(p.bytesRead),
			totalBytes: int0(p.totalBytes),
			...(p.problem ? { problem: clip(p.problem, MAX_NAME_CHARS) } : {}),
		});
	}
	return out;
}

function classifyCostSource(reported: number, estimated: number, unpriced: number): StatsCostSource {
	if (reported > 0 && estimated > 0) return "mixed";
	if (reported > 0) return "provider_reported";
	if (estimated > 0) return "api_estimate";
	if (unpriced > 0) return "unpriced";
	return "api_estimate";
}

function parseHarnessList(csv: string | null): StatsHarness[] {
	if (!csv) return [];
	const allowed = new Set<string>(HARNESSES);
	return csv.split(",").filter((h): h is StatsHarness => allowed.has(h));
}

function clampSeriesStart(sinceDay: string, untilDay: string, maxDays: number): string {
	const minAllowed = addDays(untilDay, -(maxDays - 1));
	return sinceDay < minAllowed ? minAllowed : sinceDay;
}

function addDays(day: string, delta: number): string {
	const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
	d.setUTCDate(d.getUTCDate() + delta);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function shortDayLabel(day: string): string {
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const m = months[Number(day.slice(5, 7)) - 1] ?? "";
	return `${m} ${Number(day.slice(8, 10))}`;
}

function formatHourLabel(hourKey: string, timeZone: string): string {
	const ms = Date.parse(`${hourKey}:00:00Z`);
	if (!Number.isFinite(ms)) return hourKey.slice(11);
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(new Date(ms));
	} catch {
		return hourKey.slice(11);
	}
}

function validTimeZone(tz: string | undefined): string {
	const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	if (!tz) return fallback;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return tz;
	} catch {
		return fallback;
	}
}

function int0(v: number | undefined | null): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function nonNeg(v: number | undefined | null): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
