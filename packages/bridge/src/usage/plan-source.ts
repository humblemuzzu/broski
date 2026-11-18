import type { PlanId, UsageWindow } from "../contract";

/** What one read of a plan found: its windows, or why there are none this time. */
export type PlanReading =
	| { readonly windows: readonly UsageWindow[]; readonly tier?: string }
	| { readonly problem: string; readonly tier?: string };

/** One plan's service. `read` answers undefined when the plan has no sign-in on this machine. */
export interface PlanSource {
	readonly plan: PlanId;
	read(): Promise<PlanReading | undefined>;
}

/** A token is used only while it has this long left, so it does not lapse on the way. */
export const EXPIRY_MARGIN_MS = 60_000;
