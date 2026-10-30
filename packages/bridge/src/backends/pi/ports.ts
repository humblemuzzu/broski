/**
 * The interfaces one part of the Pi adapter offers another, so the store, the live sessions, the
 * interactions and the op can be built apart and joined in `backend.ts`.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
	ActionResult,
	AttachmentId,
	AttachmentReadResult,
	ChangedFilesListed,
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
	TranscriptItemId,
	TranscriptReadResult,
	TreeRead,
} from "../../contract";
import type { ToolCallIds } from "./ids";
import type { LiveState } from "./live/live-state";
import type { PermissionsMode } from "./modes";
import type { CheckedHeader } from "./transfer/session-check";

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
	/** The entries of the session file as the tree `/tree` shows them, newest first. */
	tree(sessionId: SessionId, page: PageRequest): Promise<TreeRead | Rejected>;
	locate(sessionId: SessionId): Promise<StoredSession | Rejected>;
	/** Where a new session of `cwd` is written, as the `pi` command would write it (D7). */
	sessionDirFor(cwd: string): string;
	/** The entry `itemId` came from, when it is on the branch the transcript shows now. */
	entryOf(sessionId: SessionId, itemId: TranscriptItemId, live: LiveOverlay): Promise<string | undefined | Rejected>;
	/** `name` is `sessionName`'s. */
	rename(sessionId: SessionId, name: string): Promise<ActionResult>;
	/** Writes the `broski.origin` entry a session this bridge creates starts with; a session that has one is untouched. */
	claim(sessionId: SessionId): Promise<ActionResult>;
	/** `release` runs once the file may be deleted and before it is: the session's host ends there. */
	remove(sessionId: SessionId, release: () => Promise<void>): Promise<ActionResult>;
	fork(sessionId: SessionId, at: ForkPoint | undefined, live: LiveOverlay): Promise<NewSessionResult>;
	/** The files the session's tool calls changed, with the lines added and removed (`store/changed-files.ts`). */
	changedFiles(sessionId: SessionId, live: LiveOverlay): Promise<ChangedFilesListed | Rejected>;
	/** Takes the checked session file at `source` into the sessions directory its project uses; see `store/import-file.ts`. */
	importSession(header: CheckedHeader, source: string): Promise<{ readonly sessionId: SessionId } | Rejected>;
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

/** How the op (`ops/take-over.ts`) reaches the registry of hosted sessions (`live/`). */
export interface OwnershipAccess {
	/**
	 * Makes a session another client wrote this bridge's and hosts it, under the session lock. `claim` runs inside the
	 * lock on the stored session and either refuses or writes the mark that makes the session this bridge's.
	 */
	takeOver(sessionId: SessionId, claim: (stored: StoredSession) => Promise<ActionResult>): Promise<ActionResult>;
}

/** The `AgentSession` of a session this bridge hosts now, without waiting for the session lock. */
export interface HostedPeek {
	session(sessionId: SessionId): AgentSession | undefined;
}

/** How the op (`ops/navigate-tree.ts`) reaches a session's `AgentSession` (`live/`). */
export interface HostAccess {
	/**
	 * Runs `work` under the session lock on the live session, hosting the session for the duration
	 * when nobody does. `not_found` for an unknown session; `unsupported` for one another client made
	 * (watch-only); `busy` while a run, a compaction or an ask is under way.
	 */
	withIdleSession<T>(sessionId: SessionId, work: (session: AgentSession) => Promise<T>): Promise<T | Rejected>;
}

/** How the ops of `ops/session-*.ts` and `ops/system-prompt.ts` reach the `AgentSession` of a session that is open here (`live/`). */
export interface LiveSessionAccess {
	/**
	 * Runs `work` on the session this bridge hosts, whatever it is doing. `not_found` for an unknown session or one that is
	 * not open here; `unsupported` for one a terminal or another client runs; `busy` while its extensions start.
	 */
	withLiveSession<T>(sessionId: SessionId, work: (session: AgentSession) => T | Promise<T>): Promise<T | Rejected>;
}
