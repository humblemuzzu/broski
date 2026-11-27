/** The live sessions (`live/`, `process/`): what the backend and the asks reach them through. */

import type {
	AgentEvent,
	NativeIds,
	OpenResult,
	OpenTarget,
	SessionId,
	SessionRef,
	SessionSink,
	SessionSnapshot,
	SessionSummary,
} from "../../../contract";
import type { ChildPart } from "../ids";
import type { LiveOverlay } from "./store";

/** One open session's state (the kit's `LiveState`): every event goes through `emit`, so `snapshot()` stays exact. */
export interface SessionEmitter {
	snapshot(): SessionSnapshot;
	emit(event: AgentEvent, native?: NativeIds): void;
}

/**
 * Every session this bridge hosts (D1). `backend.ts` routes a child ref to `openChild` and a session a terminal is
 * writing to the terminal watch (D28) before it calls `open`.
 */
export interface LiveSessions extends LiveOverlay {
	/** A new session gets its id before it starts (D2) and is claimed in the owner journal; an existing one resumes. */
	open(target: OpenTarget, sink: SessionSink): Promise<OpenResult>;
	/** Watch-only; its parent's host forwards the child's live work while it runs it (D20). */
	openChild(ref: SessionRef, child: ChildPart, sink: SessionSink): Promise<OpenResult>;
	/** A host runs the session, or one that ended has not yet noted its own last write (D25). */
	isHosted(sessionId: SessionId): boolean;
	/** The working directory of a live hosted session, even before its first turn writes a transcript file. */
	cwdOf(sessionId: SessionId): string | undefined;
	/** A live hosted session's summary, used before the CLI has flushed the session's first transcript entry. */
	summary(sessionId: SessionId): SessionSummary | undefined;
	/** Ends the session's host, if any, before its file goes (D27). */
	end(sessionId: SessionId): Promise<void>;
	/** Ends every host; nothing is emitted afterwards. */
	dispose(): Promise<void>;
}
