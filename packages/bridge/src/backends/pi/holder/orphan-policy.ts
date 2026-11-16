/**
 * How long a holder keeps its `pi` with no bridge attached. Work under way goes on, since a bridge restart is what this
 * is for; an ask waits the longest, for a human who may answer from a phone tomorrow. Past its limit the holder stops
 * `pi`, which saves whatever the session did in its file anyway.
 */

import type { ReplayState } from "./replay-log";

export interface OrphanLimits {
	readonly idleMs: number;
	readonly runningMs: number;
	readonly askingMs: number;
}

export const ORPHAN_LIMITS: OrphanLimits = {
	idleMs: 10 * 60_000,
	runningMs: 4 * 60 * 60_000,
	askingMs: 24 * 60 * 60_000,
};

/** When an unattached holder stops `pi`; an idle session counts from when it went idle, if that is later. */
export function orphanDeadline(
	state: ReplayState,
	at: { readonly orphanedAt: number; readonly idleSince: number },
	limits: OrphanLimits,
): number {
	if (state.asking) return at.orphanedAt + limits.askingMs;
	if (state.running) return at.orphanedAt + limits.runningMs;
	return Math.max(at.orphanedAt, at.idleSince) + limits.idleMs;
}
