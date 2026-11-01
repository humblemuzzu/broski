/** The live sessions (lane D, `live/`, `process/`): what the backend, the asks and the ops reach them through. */

import type {
	Query,
	SDKSystemMessage,
	SDKTaskNotificationMessage,
	SDKTaskUpdatedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
	AgentEvent,
	NativeIds,
	OpenResult,
	OpenTarget,
	Rejected,
	SessionId,
	SessionRef,
	SessionSink,
	SessionSnapshot,
} from "../../../contract";
import type { ChildPart } from "../ids";
import type { LiveOverlay } from "./store";

/** One open session's state (`live/live-state.ts`): every event goes through `emit`, so `snapshot()` stays exact. */
export interface SessionEmitter {
	snapshot(): SessionSnapshot;
	emit(event: AgentEvent, native?: NativeIds): void;
}

export type TaskStatus = NonNullable<SDKTaskUpdatedMessage["patch"]["status"]> | SDKTaskNotificationMessage["status"];

/** A background task of a hosted session, from its `task_*` and `background_tasks_changed` frames. */
export interface BackgroundTask {
	readonly taskId: string;
	readonly description: string;
	readonly status: TaskStatus;
	readonly taskType?: string;
	readonly toolUseId?: string;
}

/** What an op (lane F) sees of a host. */
export interface HostView {
	readonly sessionId: SessionId;
	readonly cwd: string;
	/** For control requests only: never iterate, `close` or `interrupt` it; Stop is the host's (D8). */
	readonly query: Query;
	tasks(): readonly BackgroundTask[];
	/** A run, an ask or a compaction is under way. */
	busy(): boolean;
	/**
	 * The latest `system/init` of the host's current process: what the CLI loaded and decided for the session (its
	 * model, plugins and plugin errors, fast mode). One comes with every turn and none before the first, so it is
	 * undefined until the process ran a turn, after a new process starts, and always on a transient host (Step 7).
	 */
	latestInit(): SDKSystemMessage | undefined;
}

/**
 * Every session this bridge hosts (D1). `backend.ts` routes a child ref to `openChild` and a session a terminal is
 * writing to the terminal watch (D21) before it calls `open`.
 */
export interface LiveSessions extends LiveOverlay {
	/** A new session gets its id before it starts (D2) and is claimed in the owner journal; an existing one resumes. */
	open(target: OpenTarget, sink: SessionSink): Promise<OpenResult>;
	/** Watch-only; its parent's host forwards the child's live work while it runs it (D20). */
	openChild(ref: SessionRef, child: ChildPart, sink: SessionSink): Promise<OpenResult>;
	/** A host runs the session, or one that ended has not yet noted its own last write (D122). */
	isHosted(sessionId: SessionId): boolean;
	/** `work(undefined)` when the session exists but nobody hosts it; `not_found` when it does not exist. */
	withLiveHost<T>(sessionId: SessionId, work: (host: HostView | undefined) => Promise<T>): Promise<T | Rejected>;
	/**
	 * `work` on the session's host, else on a transient host (a resume with an empty inbox, closed in `finally`, D23).
	 * `not_found`; `unsupported` for a session a terminal is writing (D21). An op that needs it idle checks `busy()`.
	 */
	withHost<T>(sessionId: SessionId, work: (host: HostView) => Promise<T>): Promise<T | Rejected>;
	/** Ends the session's host, if any, before its file goes (D19). */
	end(sessionId: SessionId): Promise<void>;
	/** Ends every host; nothing is emitted afterwards. */
	dispose(): Promise<void>;
}
