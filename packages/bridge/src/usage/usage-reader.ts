import { join } from "node:path";
import { MAX_NAME_CHARS, type PlanId, type PlanMeter, type PlanUsageResult, type UsageWindow } from "../contract";
import { clip } from "../contract/clip";
import type { UsageReader } from "../core/ports";
import { claudeSource } from "./claude-usage";
import type { PlanReading, PlanSource } from "./plan-source";
import type { UsageSystem } from "./system";
import { fileHistoryStore, UsageHistory } from "./usage-history";

/**
 * How long one reading answers every phone: Claude Code keeps its own as long, and the services meter how often
 * they are asked.
 */
export const FRESH_FOR_MS = 60_000;
/** How often the bridge reads by itself, so a phone that was away still finds a history to chart. */
export const SAMPLE_EVERY_MS = 15 * 60_000;

/** The reader, and its own reading every `SAMPLE_EVERY_MS` until the function `sample` answers is called. */
export interface SampledUsage extends UsageReader {
	sample(): () => void;
}

/**
 * The plans signed in on this machine, Claude and any `extraSources` beside it, with their history in
 * `<broskiDir>/usage/history.json`. An extra source whose plan id is taken already is left out. Antigravity's plan is
 * not read: its usage is only behind Google's internal endpoints and agy's own sign-in, which no third-party client may
 * use (antigravity README, "Google's rules").
 */
export function machineUsage(
	system: UsageSystem,
	broskiDir: string,
	log: (message: string) => void,
	extraSources: readonly PlanSource[] = [],
): SampledUsage {
	const history = new UsageHistory(fileHistoryStore(join(broskiDir, "usage", "history.json"), log));
	const sources = distinctPlans([claudeSource(system), ...extraSources], log);
	const reader = usageReader(sources, () => system.now(), history);
	return {
		read: () => reader.read(),
		sample() {
			void reader.read();
			const timer = setInterval(() => void reader.read(), SAMPLE_EVERY_MS);
			timer.unref?.();
			return () => clearInterval(timer);
		},
	};
}

/**
 * Reads every plan at once and keeps the answer for `FRESH_FOR_MS`, a read still running included, so phones
 * asking together cost the services one request. A plan that fails keeps the windows it last read, with why.
 */
export function usageReader(
	sources: readonly PlanSource[],
	now: () => number,
	history: UsageHistory = new UsageHistory(),
): UsageReader {
	const kept = new Map<PlanId, PlanMeter>();
	let latest: { readonly at: number; readonly result: Promise<PlanUsageResult> } | undefined;

	async function readAll(at: number): Promise<PlanUsageResult> {
		const meters = await Promise.all(sources.map(async (source) => meterOf(source, await settle(source), at)));
		for (const [index, source] of sources.entries()) {
			const meter = meters[index];
			if (meter) kept.set(source.plan, meter);
			else kept.delete(source.plan);
		}
		return { status: "accepted", meters: meters.filter((meter): meter is PlanMeter => meter !== undefined) };
	}

	function meterOf(source: PlanSource, reading: PlanReading | undefined, at: number): PlanMeter | undefined {
		if (reading === undefined) return undefined;
		const earlier = kept.get(source.plan);
		const tier = reading.tier ?? earlier?.tier;
		const named = tier === undefined ? {} : { tier: clip(tier, MAX_NAME_CHARS) };
		if ("windows" in reading) {
			const windows = history.record(source.plan, reading.windows.map(fitted), at);
			return { plan: source.plan, displayName: source.displayName, ...named, windows, readAt: at };
		}
		return {
			plan: source.plan,
			displayName: source.displayName,
			...named,
			windows: earlier?.windows ?? [],
			...(earlier?.readAt !== undefined && { readAt: earlier.readAt }),
			problem: clip(reading.problem, MAX_NAME_CHARS),
		};
	}

	return {
		read() {
			const at = now();
			if (latest && at - latest.at < FRESH_FOR_MS) return latest.result;
			latest = { at, result: readAll(at) };
			return latest.result;
		},
	};
}

function distinctPlans(sources: readonly PlanSource[], log: (message: string) => void): PlanSource[] {
	const plans = new Set<PlanId>();
	return sources.filter((source) => {
		if (plans.has(source.plan)) {
			log(`[usage] a second ${source.plan} plan source is left out`);
			return false;
		}
		plans.add(source.plan);
		return true;
	});
}

async function settle(source: PlanSource): Promise<PlanReading | undefined> {
	try {
		return await source.read();
	} catch (error) {
		return {
			problem: `Reading the ${source.plan} plan failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function fitted(window: UsageWindow): UsageWindow {
	return window.scope === undefined ? window : { ...window, scope: clip(window.scope, MAX_NAME_CHARS) };
}
