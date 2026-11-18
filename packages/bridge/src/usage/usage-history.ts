/**
 * What the bridge read of each window since it last started over, for the phone's charts. The bridge is the one
 * that is always on, so it keeps the history: a point per 1/120th of a window's span (a later reading within the
 * same step replaces the earlier), the points before the window's start dropped as it starts over.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { MAX_USAGE_POINTS, type PlanId, UsagePoint, type UsageSpan, type UsageWindow } from "../contract";

export const SPAN_MS: Readonly<Record<UsageSpan, number>> = { five_hour: 5 * 3_600_000, week: 7 * 86_400_000 };
const STEPS = 120;
/** A series not read for longer than the longest span belongs to a window that is gone. */
const FORGET_AFTER_MS = SPAN_MS.week + 86_400_000;

/** Where the history outlives a bridge restart; both methods handle their own I/O failures. */
export interface HistoryStore {
	load(): Record<string, UsagePoint[]>;
	save(series: Record<string, UsagePoint[]>): void;
}

export class UsageHistory {
	private readonly series: Map<string, UsagePoint[]>;

	constructor(private readonly store?: HistoryStore) {
		this.series = new Map(Object.entries(store?.load() ?? {}));
	}

	/** Records a reading of `plan`'s windows taken at `at`, and answers the windows with their history. */
	record(plan: PlanId, windows: readonly UsageWindow[], at: number): UsageWindow[] {
		const read = windows.map((window) => this.recordOne(`${plan}:${window.id}`, window, at));
		for (const [key, points] of this.series) {
			const last = points.at(-1);
			if (!last || at - last.at > FORGET_AFTER_MS) this.series.delete(key);
		}
		this.store?.save(Object.fromEntries(this.series));
		return read;
	}

	private recordOne(key: string, window: UsageWindow, at: number): UsageWindow {
		if (window.resetsAt === undefined) {
			this.series.delete(key);
			return window;
		}
		const span = SPAN_MS[window.span];
		const start = window.resetsAt - span;
		const points = (this.series.get(key) ?? []).filter((point) => point.at >= start && point.at <= at);
		const point = { at, usedPercent: window.usedPercent };
		const last = points.at(-1);
		if (last && at - last.at < span / STEPS) points[points.length - 1] = point;
		else points.push(point);
		const kept = points.slice(-MAX_USAGE_POINTS);
		this.series.set(key, kept);
		return { ...window, history: kept.map((entry) => ({ ...entry })) };
	}
}

const StoredHistory = z.object({ version: z.literal(1), series: z.record(z.string(), z.array(UsagePoint)) });

/** The history as one JSON file, replaced whole on each save. */
export function fileHistoryStore(path: string, log: (message: string) => void): HistoryStore {
	return {
		load() {
			try {
				const parsed = StoredHistory.safeParse(JSON.parse(readFileSync(path, "utf8")));
				return parsed.success ? parsed.data.series : {};
			} catch {
				return {};
			}
		},
		save(series) {
			try {
				mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
				const next = `${path}.next`;
				writeFileSync(next, JSON.stringify({ version: 1, series }), { mode: 0o600 });
				renameSync(next, path);
			} catch (error) {
				log(`[usage] the history was not saved: ${String(error)}`);
			}
		},
	};
}
