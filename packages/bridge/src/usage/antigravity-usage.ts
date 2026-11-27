/**
 * Antigravity's plan usage, from agy's own status line (antigravity.google/docs/cli/statusline): agy's terminal UI hands
 * its status-line command the plan's quota buckets, and a status line set up for Broski keeps the latest of them in
 * `<broskiDir>/antigravity/quota.json` as `{captured_at_ms, quota}`. Nothing here asks Google or agy for anything: Google
 * lets third-party clients reach Antigravity over ACP only, and ACP carries no limits (antigravity README, "Usage").
 * agy runs the status line only in its terminal UI, so the reading is as fresh as the person's last terminal session,
 * and the meter says when it was taken. The plan's name is what agy last said over ACP.
 */

import { join } from "node:path";
import { z } from "zod";
import { MAX_NAME_CHARS, MAX_USAGE_WINDOWS, type UsageSpan, type UsageWindow } from "../contract";
import { clip } from "../contract/clip";
import { epochMs, percent } from "./fetch-json";
import type { PlanReading, PlanSource } from "./plan-source";
import type { UsageSystem } from "./system";

export const NO_READING =
	"agy shows its limits to its status line: use agy in a terminal with the status line Broski reads (antigravity README, Usage).";

const Bucket = z.object({
	remaining_fraction: z.number().finite().min(0).max(1).optional().catch(undefined),
	reset_time: z.string().optional().catch(undefined),
	reset_in_seconds: z.number().finite().nonnegative().optional().catch(undefined),
	disabled: z.boolean().optional().catch(undefined),
});
type Bucket = z.infer<typeof Bucket>;

const Reading = z.object({
	captured_at_ms: z.number().int().positive(),
	quota: z.record(z.string().min(1), z.unknown()),
});

/** Bucket ids name their models' group, then their span: `gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly`. */
const SPANS: ReadonlyArray<readonly [string, UsageSpan]> = [
	["-5h", "five_hour"],
	["-weekly", "week"],
];
/** What agy's groups cover: `3p` is its third-party models, which are Claude's. */
const SCOPES: Readonly<Record<string, string>> = { gemini: "Gemini", "3p": "Claude" };

export function antigravitySource(system: UsageSystem, broskiDir: string, plan: () => string | undefined): PlanSource {
	const path = join(broskiDir, "antigravity", "quota.json");
	return {
		plan: "antigravity",
		displayName: "Antigravity",
		async read(): Promise<PlanReading | undefined> {
			const name = plan();
			const tier = name === undefined ? {} : { tier: name };
			const text = await system.readText(path);
			if (text === undefined) return name === undefined ? undefined : { problem: NO_READING, ...tier };
			const reading = Reading.safeParse(parsed(text));
			if (!reading.success) return { problem: `Broski cannot read agy's status-line reading in ${path}.`, ...tier };
			const { captured_at_ms: at, quota } = reading.data;
			return { windows: windowsOf(quota, at), readAt: at, ...tier };
		},
	};
}

export function windowsOf(quota: Readonly<Record<string, unknown>>, capturedAt: number): UsageWindow[] {
	return Object.entries(quota)
		.flatMap(([id, value]) => {
			const bucket = Bucket.safeParse(value);
			return bucket.success ? windowOf(id, bucket.data, capturedAt) : [];
		})
		.slice(0, MAX_USAGE_WINDOWS);
}

/** A bucket that reports only `remaining_amount` has no share of a whole to draw, so it is left out. */
function windowOf(id: string, bucket: Bucket, capturedAt: number): UsageWindow[] {
	const span = SPANS.find(([suffix]) => id.endsWith(suffix));
	if (span === undefined || bucket.disabled === true || bucket.remaining_fraction === undefined) return [];
	const group = id.slice(0, -span[0].length);
	const scope = SCOPES[group] ?? group;
	const resetsAt =
		epochMs(bucket.reset_time) ??
		(bucket.reset_in_seconds === undefined ? undefined : capturedAt + bucket.reset_in_seconds * 1_000);
	return [
		{
			id: clip(id, MAX_NAME_CHARS),
			span: span[1],
			...(scope !== "" && { scope: clip(scope, MAX_NAME_CHARS) }),
			usedPercent: percent((1 - bucket.remaining_fraction) * 100),
			...(resetsAt !== undefined && { resetsAt: Math.round(resetsAt) }),
		},
	];
}

function parsed(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
