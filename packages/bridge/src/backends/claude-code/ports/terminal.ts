/** Terminal sessions: watched, never written (D28), and the terminal permission hook (D29). */

import type { PermissionRequestHookInput, PermissionRequestHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import type { OpenResult, SessionId, SessionRef, SessionSink } from "../../../contract";
import type { StoredSession } from "./store";

export interface TerminalPresence {
	/** Another process wrote the session's file in the last 10 s and this bridge does not host it. */
	writing(sessionId: SessionId): Promise<boolean>;
}

export interface TerminalWatch extends TerminalPresence {
	/** An `OpenSession` without `control`, fed by the live tail. */
	openWatchOnly(ref: SessionRef, stored: StoredSession, sink: SessionSink): Promise<OpenResult>;
	start(): Promise<void>;
	dispose(): Promise<void>;
}

export type TerminalPermissionDecision = PermissionRequestHookSpecificOutput["decision"];

/** Undefined: no decision, and the terminal asks its own user. */
export type TerminalAskHandler = (
	ask: PermissionRequestHookInput,
	signal: AbortSignal,
) => Promise<TerminalPermissionDecision | undefined>;

export interface TerminalOptions {
	/** The server's hook receiver takes the adapter's handler here once, at start (D29). */
	readonly hookAsks?: (handler: TerminalAskHandler) => void;
}
