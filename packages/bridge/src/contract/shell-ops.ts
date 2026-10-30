import { z } from "zod";
import { ClientRequestId, SessionId } from "./ids";
import { MAX_TEXT_CHARS } from "./limits";

/** The op kinds that run a shell command the person typed (since 1.3, `ADDED_IN_MINOR.shellOps`). */
export const SHELL_OP_KINDS = ["run_shell"] as const;

/**
 * Pi: run `command` in the session's directory as the person's own (`!command`, or `!!command` with
 * `excludeFromContext`, which keeps the output out of what the model is sent). It runs as a run of the session: a
 * `bash` tool call streams the output, and Stop ends the command alone. Accepted once it has started; a repeat of
 * `clientRequestId` returns the first answer and runs nothing.
 */
export const RunShellOp = z.strictObject({
	kind: z.literal("run_shell"),
	sessionId: SessionId,
	clientRequestId: ClientRequestId,
	command: z.string().min(1).max(MAX_TEXT_CHARS),
	excludeFromContext: z.boolean(),
});
export type RunShellOp = z.infer<typeof RunShellOp>;

export const ShellStarted = z.strictObject({ kind: z.literal("run_shell") });
export type ShellStarted = z.infer<typeof ShellStarted>;
