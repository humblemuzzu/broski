import { z } from "zod";
import { Timestamp } from "./ids";
import { MAX_NAME_CHARS, MAX_USAGE_POINTS, MAX_USAGE_WINDOWS } from "./limits";
import { Rejected } from "./rejection";

/** The subscriptions the bridge can meter: Claude's plan (claude.ai) and Google Antigravity's. */
export const PlanId = z.enum(["claude", "antigravity"]);
export type PlanId = z.infer<typeof PlanId>;

/** How long a window runs before it starts over: the rolling five hours, or the week. */
export const UsageSpan = z.enum(["five_hour", "week"]);
export type UsageSpan = z.infer<typeof UsageSpan>;

/** A window's use at one moment, as the bridge read it. */
export const UsagePoint = z.strictObject({
	at: Timestamp,
	usedPercent: z.number().min(0).max(100),
});
export type UsagePoint = z.infer<typeof UsagePoint>;

/**
 * One allowance of a plan, as the plan's own service reports it. `scope` names what the window covers when that
 * is not the whole plan (one model, or a group of models). `resetsAt` is absent while the window has not started.
 * `history` is what the bridge read of the window since it last started over, oldest first; absent when it has
 * read none.
 */
export const UsageWindow = z.strictObject({
	id: z.string().min(1).max(MAX_NAME_CHARS),
	span: UsageSpan,
	scope: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	usedPercent: z.number().min(0).max(100),
	resetsAt: Timestamp.optional(),
	history: z.array(UsagePoint).max(MAX_USAGE_POINTS).optional(),
});
export type UsageWindow = z.infer<typeof UsageWindow>;

/**
 * One plan signed in on the machine. `readAt` is when its service last answered; when the latest read failed,
 * `problem` says why and the windows are those of that last answer (none when there was none).
 */
export const PlanMeter = z.strictObject({
	plan: PlanId,
	tier: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	windows: z.array(UsageWindow).max(MAX_USAGE_WINDOWS),
	readAt: Timestamp.optional(),
	problem: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type PlanMeter = z.infer<typeof PlanMeter>;

/** Every plan signed in on the machine, in `PlanId` order; a plan with no sign-in there is left out. */
export const PlanUsage = z.strictObject({
	status: z.literal("accepted"),
	meters: z.array(PlanMeter).max(PlanId.options.length),
});
export type PlanUsage = z.infer<typeof PlanUsage>;

export const PlanUsageResult = z.discriminatedUnion("status", [PlanUsage, Rejected]);
export type PlanUsageResult = z.infer<typeof PlanUsageResult>;
