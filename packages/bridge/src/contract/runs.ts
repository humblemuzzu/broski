import { z } from "zod";
import { MAX_TEXT_CHARS } from "./limits";

/**
 * `prompt`: input sent through this bridge, including an action the backend runs as a run, such as
 * a Codex compaction or review. `queue`: a queued prompt dispatched as the previous run ended.
 * `system`: the backend woke itself (goal, scheduled wakeup, background task, restart recovery).
 * `external`: another client of the same backend, such as its terminal UI.
 */
export const RunTrigger = z.enum(["prompt", "queue", "system", "external"]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const ErrorCode = z.enum([
	"auth",
	"rate_limit",
	"quota",
	"context_overflow",
	"model_unavailable",
	"content_filter",
	"network",
	"server",
	"tool",
	"invalid_request",
	"backend_unavailable",
	"unknown",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorInfo = z.strictObject({ code: ErrorCode, message: z.string().max(MAX_TEXT_CHARS) });
export type ErrorInfo = z.infer<typeof ErrorInfo>;

export const RunLimit = z.enum(["max_turns", "budget", "output_tokens"]);
export type RunLimit = z.infer<typeof RunLimit>;

export const RunCompleted = z.strictObject({ kind: z.literal("completed") });
export type RunCompleted = z.infer<typeof RunCompleted>;

export const RunAborted = z.strictObject({ kind: z.literal("aborted") });
export type RunAborted = z.infer<typeof RunAborted>;

export const RunErrored = z.strictObject({ kind: z.literal("error"), error: ErrorInfo });
export type RunErrored = z.infer<typeof RunErrored>;

export const RunLimited = z.strictObject({ kind: z.literal("limit"), limit: RunLimit });
export type RunLimited = z.infer<typeof RunLimited>;

/** Interrupted by a backend shutdown; the backend resumes the run when it restarts. */
export const RunSuspended = z.strictObject({ kind: z.literal("suspended") });
export type RunSuspended = z.infer<typeof RunSuspended>;

/** Ended waiting on a deferred tool call that a later run answers. */
export const RunDeferred = z.strictObject({ kind: z.literal("deferred") });
export type RunDeferred = z.infer<typeof RunDeferred>;

export const RunOutcome = z.discriminatedUnion("kind", [
	RunCompleted,
	RunAborted,
	RunErrored,
	RunLimited,
	RunSuspended,
	RunDeferred,
]);
export type RunOutcome = z.infer<typeof RunOutcome>;
