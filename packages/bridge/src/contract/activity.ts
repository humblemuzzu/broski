import { z } from "zod";
import { SessionRef, Timestamp } from "./ids";
import { MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

/**
 * `task`: background work the agent started (a shell, a monitor, a workflow). `agent`: a subagent. `command`: a
 * command the person ran outside the conversation, such as a slash command or a shell escape. `message`: anything
 * else an agent or one of its extensions posts that is not a turn.
 */
export const ActivityKind = z.enum(["task", "agent", "command", "message"]);
export type ActivityKind = z.infer<typeof ActivityKind>;

/** `running`: the work reported in but goes on. */
export const ActivityStatus = z.enum(["running", "completed", "failed", "stopped"]);
export type ActivityStatus = z.infer<typeof ActivityStatus>;

/** `log`: monospaced output whose newest lines matter most. */
export const ActivityFormat = z.enum(["markdown", "text", "log"]);
export type ActivityFormat = z.infer<typeof ActivityFormat>;

export const ActivityBody = z.strictObject({
	format: ActivityFormat,
	text: z.string().min(1).max(MAX_TEXT_CHARS),
});
export type ActivityBody = z.infer<typeof ActivityBody>;

/** Something that happened in a session that is not a turn: a background task that ended, a subagent's report. */
export const Activity = z.strictObject({
	kind: ActivityKind,
	/** One line that says what happened. */
	title: z.string().min(1).max(MAX_NAME_CHARS),
	status: ActivityStatus.optional(),
	/** The shell command the work ran, exactly as written. */
	command: z.string().max(MAX_TEXT_CHARS).optional(),
	durationMs: z.int().nonnegative().optional(),
	exitCode: z.int().optional(),
	body: ActivityBody.optional(),
	/** The session a subagent ran in. */
	childSession: SessionRef.optional(),
});
export type Activity = z.infer<typeof Activity>;

export const BackgroundTaskKind = z.enum(["task", "agent"]);
export type BackgroundTaskKind = z.infer<typeof BackgroundTaskKind>;

/** Work the agent left running in the background, which reports back as an `activity` when it ends. */
export const BackgroundTask = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	kind: BackgroundTaskKind,
	title: z.string().min(1).max(MAX_NAME_CHARS),
	command: z.string().max(MAX_TEXT_CHARS).optional(),
	startedAt: Timestamp.optional(),
	childSession: SessionRef.optional(),
});
export type BackgroundTask = z.infer<typeof BackgroundTask>;
