import { z } from "zod";
import { Timestamp } from "./ids";
import { MAX_NAME_CHARS } from "./limits";

export const ExtensionKind = z.enum(["rate_limit"]);
export type ExtensionKind = z.infer<typeof ExtensionKind>;

export const RateLimitStatus = z.enum(["allowed", "allowed_warning", "rejected"]);
export type RateLimitStatus = z.infer<typeof RateLimitStatus>;

/** Claude Code: one window of the account's subscription rate limit. */
export const RateLimitUpdate = z.strictObject({
	kind: z.literal(ExtensionKind.enum.rate_limit),
	/** The window as the backend names it, such as `five_hour`. */
	window: z.string().min(1).max(MAX_NAME_CHARS),
	status: RateLimitStatus.optional(),
	usedPercent: z.number().nonnegative().optional(),
	resetsAt: Timestamp.optional(),
});
export type RateLimitUpdate = z.infer<typeof RateLimitUpdate>;

/** A backend-specific live event, typed per backend. */
export const BackendExtension = z.discriminatedUnion("kind", [RateLimitUpdate]);
export type BackendExtension = z.infer<typeof BackendExtension>;
