/**
 * The interfaces one part of the Pi adapter offers another, so the store, the live sessions and the
 * interactions can be built apart and joined in `backend.ts`.
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
	ActionResult,
	AttachmentId,
	AttachmentReadResult,
	ForkPoint,
	InteractionAnswer,
	ModelId,
	NewSessionResult,
	PageRequest,
	Rejected,
	RunId,
	SessionGetResult,
	SessionId,
	SessionOrigin,
	SessionQuery,
	SessionStatus,
	SessionSummary,
	SessionsListResult,
	TranscriptReadResult,
} from "../../contract";
import type { ToolCallIds } from "./ids";
import type { LiveState } from "./live/live-state";
import type { PermissionsMode } from "./modes";

/** One member of Pi's session event union (pi-coding-agent `dist/core/agent-session.d.ts:47-109`). */
export type PiEvent<T extends AgentSessionEvent["type"]> = Extract<AgentSessionEvent, { type: T }>;

/** While a run is active the transcript ends at the entry that was the leaf when it started (README §8). */
export interface TranscriptCut {
	/** Null: no entry preceded the run, so the transcript is empty. */
	readonly leafEntryId: string | null;
}

/** What the live sessions know of a session they host, for the store's rows and pages. */
export interface LiveRow {
	readonly status: SessionStatus;
	readonly modelId?: ModelId;
	/** Present exactly while a run is active. */
	readonly cut?: TranscriptCut;
}

/** Implemented by the live sessions (`live/`), read by the store (`store/`) on every read. */
export interface LiveOverlay {
	row(sessionId: SessionId): LiveRow | undefined;
	/** The children of a hosted session whose tool calls still run: their result is not in the file yet. */
	unwritten?(parentId: SessionId): readonly SessionSummary[];
}

/** A session file the store found, as the live sessions need it to host the session. */
export interface StoredSession {
	readonly sessionId: SessionId;
	readonly path: string;
	/** The header's `cwd`; undefined when the header holds `""` (old sessions). */
	readonly cwd: string | undefined;
	readonly origin: SessionOrigin;
}

/**
 * Everything read from or written to session files without a live `AgentSession` (`store/`). Its
 * mutations are for sessions nobody hosts; a hosted session is written only through its host.
 */
export interface SessionStore {
	list(query: SessionQuery, page: PageRequest, live: LiveOverlay): Promise<SessionsListResult>;
	get(sessionId: SessionId, live: LiveOverlay): Promise<SessionGetResult>;
	transcript(sessionId: SessionId, page: PageRequest, live: LiveOverlay): Promise<TranscriptReadResult>;
	attachment(sessionId: SessionId, attachment: AttachmentId): Promise<AttachmentReadResult>;
	locate(sessionId: SessionId): Promise<StoredSession | Rejected>;
	/** Where a new session of `cwd` is written, as the `pi` command would write it (D7). */
	sessionDirFor(cwd: string): string;
	/** `name` is `sessionName`'s. */
	rename(sessionId: SessionId, name: string): Promise<ActionResult>;
	/** `release` runs once the file may be deleted and before it is: the session's host ends there. */
	remove(sessionId: SessionId, release: () => Promise<void>): Promise<ActionResult>;
	fork(sessionId: SessionId, at: ForkPoint | undefined, live: LiveOverlay): Promise<NewSessionResult>;
	/**
	 * From now on a session file another process adds, changes or removes reaches the catalog as
	 * `session_updated`/`session_removed`: Pi reports nothing live (README §5, catalog sink).
	 */
	watch(live: LiveOverlay): void;
	/** Stops watching; nothing is emitted afterwards. */
	dispose(): void;
}

/** The run a hosted session is in, as the parts that act inside it see it. */
export interface RunContext {
	readonly runId: RunId;
	readonly tools: ToolCallIds;
}

/** What the interaction desk (`ui/`) needs from the session it asks for (`live/`). */
export interface AskHost {
	readonly live: LiveState;
	/** The run an ask raised now belongs to: the active one, or the one a prompt Pi is still deciding starts now. */
	activeRun(): RunContext | undefined;
	/** The ask comes from an extension command the phone started (`live/command-scope.ts`), which no run owns. */
	inCommand(): boolean;
	/** Ends the active run, as a `cancel{stopRun}` answer or a gate's deny-and-stop asks. */
	abortRun(): void;
	now(): number;
}

/** The pending asks of one hosted session (`ui/interactions.ts`), as the session drives them. */
export interface InteractionPort {
	/** `answerProblem` first; a resolved id is `stale`, an unknown one `not_found` (README §5, rule 8). */
	answer(answer: InteractionAnswer): ActionResult;
	/** Every ask of `runId` resolves `withdrawn`, with Pi's default: the run is being aborted. */
	withdrawRun(runId: RunId): void;
	/** The run `runId` ended: an ask of it still pending is no longer the run's and goes on waiting on its own. */
	releaseRun(runId: RunId): void;
	/**
	 * The bridge is shutting down: every ask resolves with Pi's default and is reported `expired`, and
	 * every later ask ends at once, since `runtime.dispose()` still runs extensions' `session_shutdown`.
	 */
	expireAll(): void;
}

/** What the permission gate (`ui/permission-gate.ts`) reads from its session and tells it. */
export interface GateHost {
	permissions(): PermissionsMode;
	/** The human allowed `toolName` for the whole session. */
	allowed(toolName: string): boolean;
	allowForSession(toolName: string): void;
}

/** A terminal `pi` that has a session open and is connected through the Broski link extension (`terminal/`). */
export interface TerminalHolder {
	readonly pid: number;
}

/** Which session files a connected terminal `pi` has open now. */
export interface TerminalPresence {
	holder(sessionPath: string): TerminalHolder | undefined;
}
