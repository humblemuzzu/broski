import type { PlanId, UsageWindow } from "../contract";

/**
 * What one read of a plan found: its windows, or why there are none this time. `readAt` is when the windows were
 * measured, for a source that hands on a reading taken earlier; the read's own time when absent.
 */
export type PlanReading =
	| { readonly windows: readonly UsageWindow[]; readonly tier?: string; readonly readAt?: number }
	| { readonly problem: string; readonly tier?: string };

/** One plan's service. `read` answers undefined when the plan has no sign-in on this machine. */
export interface PlanSource {
	readonly plan: PlanId;
	readonly displayName: string;
	read(): Promise<PlanReading | undefined>;
}

/** A token is used only while it has this long left, so it does not lapse on the way. */
export const EXPIRY_MARGIN_MS = 60_000;
