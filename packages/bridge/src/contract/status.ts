import { z } from "zod";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

export const AuthState = z.enum(["signed_in", "signed_out", "unknown"]);
export type AuthState = z.infer<typeof AuthState>;

export const IssueSeverity = z.enum(["warning", "error"]);
export type IssueSeverity = z.infer<typeof IssueSeverity>;

export const StatusIssue = z.strictObject({ severity: IssueSeverity, message: z.string().min(1).max(MAX_TEXT_CHARS) });
export type StatusIssue = z.infer<typeof StatusIssue>;

/**
 * What the backend can do now. Finding out never fails: whatever stopped the adapter from finding out
 * is an `error` issue, and then `usable` is false.
 */
export const BackendStatus = z.strictObject({
	installed: z.boolean(),
	version: z.string().max(MAX_NAME_CHARS).optional(),
	auth: AuthState,
	/** A prompt can run now. */
	usable: z.boolean(),
	issues: z.array(StatusIssue).max(MAX_LIST_ITEMS),
});
export type BackendStatus = z.infer<typeof BackendStatus>;
