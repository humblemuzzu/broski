/** Terminal sessions: watched, never written (D28), and the terminal permission hook (D29). */

import type { PermissionRequestHookInput, PermissionRequestHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import type { PresenceEvent } from "../../../adapter-kit/promotable-view";
import type { OpenResult, SessionId, SessionRef, SessionSink } from "../../../contract";
import type { LiveRow, StoredSession } from "./store";

export interface TerminalPresence {
	/**
	 * This bridge does not host the session, and a terminal has it: a live terminal `claude` holds it in the CLI's
	 * register of processes, or another process wrote its file in the last 10 s.
	 */
	writing(sessionId: SessionId): Promise<boolean>;
}

export type TerminalPresenceEvent = PresenceEvent;

export interface TerminalWatch extends TerminalPresence {
	/** True when a tracked terminal `claude` holds `sessionId` idle at its prompt (not actively running a turn). */
	hasIdleTerminal(sessionId: SessionId): Promise<boolean>;
	/** An `OpenSession` without `control`, fed by the live tail. */
	openWatchOnly(ref: SessionRef, stored: StoredSession, sink: SessionSink): Promise<OpenResult>;
	/** Notifies `listener` when a tracked terminal `claude` starts or finishes a turn on `sessionId`. */
	watchPresence(sessionId: SessionId, listener: (event: TerminalPresenceEvent) => void): () => void;
	/** Flushes any final bytes written before the terminal holding `sessionId` exited and closes any open run. */
	finishExited(sessionId: SessionId): Promise<void>;
	/** The status the CLI's register gives a session a terminal `claude` holds and this bridge does not host. */
	row(sessionId: SessionId): LiveRow | undefined;
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
