/** Terminal sessions (lane G): watched, never written (D21), and the terminal permission hook (D26); STEP-3 §G. */

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

/** Undefined: no decision, and the terminal asks its own user. Blocked by a core gap (STEP-3 §9). */
export type TerminalAskHandler = (
	ask: PermissionRequestHookInput,
	signal: AbortSignal,
) => Promise<TerminalPermissionDecision | undefined>;

export interface TerminalOptions {
	/** The server's hook receiver takes the adapter's handler here once, at start (D26). */
	readonly hookAsks?: (handler: TerminalAskHandler) => void;
}
