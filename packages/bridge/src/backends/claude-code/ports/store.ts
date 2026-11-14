/** The store (lane A, `store/`, `owned.ts`) and what the live sessions (lane D) lay over it. */

import type {
	ActionResult,
	AttachmentId,
	AttachmentReadResult,
	ForkPoint,
	ModelId,
	NewSessionResult,
	PageRequest,
	Rejected,
	SessionGetResult,
	SessionId,
	SessionOrigin,
	SessionQuery,
	SessionStatus,
	SessionsListResult,
	TranscriptReadResult,
} from "../../../contract";

/** While a run is active a transcript page ends where the run began (contract README §8 rule 2). */
export interface TranscriptCut {
	/** The newest chain entry written before the run began; null when the run began the conversation. */
	readonly lastUuidBefore: string | null;
}

export interface LiveRow {
	readonly status: SessionStatus;
	readonly modelId?: ModelId;
	/** Present exactly while a run is active. */
	readonly cut?: TranscriptCut;
}

/** Implemented by the live sessions, read by the store on every read: hosted sessions' facts beat the file's. */
export interface LiveOverlay {
	row(sessionId: SessionId): LiveRow | undefined;
}

export interface StoredSession {
	readonly sessionId: SessionId;
	/** `SDKSessionInfo.cwd`; undefined when the file names none. */
	readonly cwd: string | undefined;
	/** The transcript file, found under `ClaudeSdk.configRoot()/projects/` without encoding a path (D15). */
	readonly path: string;
	readonly origin: SessionOrigin;
	readonly lastModified: number;
}

/**
 * Every read of session files, and the mutations of sessions nobody hosts. A `sessionId` may be a child ref
 * (`ids.ts` `childRef`, D20); `rename`, `fork` and `remove` refuse one `unsupported`. A cursor this store did not mint
 * is `invalid_input`; an unknown session `not_found`.
 */
export interface SessionStore {
	list(query: SessionQuery, page: PageRequest, live: LiveOverlay): Promise<SessionsListResult>;
	get(sessionId: SessionId, live: LiveOverlay): Promise<SessionGetResult>;
	/** Finished runs only: with a `LiveRow.cut`, nothing after `lastUuidBefore`. */
	transcript(sessionId: SessionId, page: PageRequest, live: LiveOverlay): Promise<TranscriptReadResult>;
	attachment(sessionId: SessionId, attachment: AttachmentId): Promise<AttachmentReadResult>;
	locate(sessionId: SessionId): Promise<StoredSession | Rejected>;
	/** The newest entry of the session's chain; null for a session with none. */
	lastChainUuid(sessionId: SessionId): Promise<string | null | Rejected>;
	rename(sessionId: SessionId, title: string, live: LiveOverlay): Promise<ActionResult>;
	/** The fork is claimed in the owner journal and announced with `session_updated`. */
	fork(sessionId: SessionId, at: ForkPoint | undefined, live: LiveOverlay): Promise<NewSessionResult>;
	/** Moves the transcript and its `<id>/` directory to the OS trash (D19) and emits `session_removed`. */
	remove(sessionId: SessionId): Promise<ActionResult>;
	/** Emits the session's row as `session_updated`; nothing when it cannot be read. Never throws. */
	announce(sessionId: SessionId, live: LiveOverlay): Promise<void>;
	/** The session's file changed under this bridge (a run ended, an op wrote it): drop what was cached of it. */
	invalidate(sessionId: SessionId): void;
	dispose(): void;
}

/** What the owner journal keeps of one prompt this bridge sent, keyed by its send uuid (D37). */
export interface PromptRecord {
	/** The `name` of each image attachment, in order: the CLI keeps no names. */
	readonly imageNames: readonly (string | undefined)[];
}

/**
 * The owner journal (`owned.ts`, D17), bounded, at `<stateDir>/owned.jsonl`. Reads are synchronous over what `load`
 * read; writes append and are visible at once.
 */
export interface Ownership {
	load(): Promise<void>;
	origin(sessionId: SessionId): SessionOrigin;
	claim(sessionId: SessionId): Promise<void>;
	notePrompt(sessionId: SessionId, sendUuid: string, record: PromptRecord): Promise<void>;
	/** Defined exactly for a prompt this bridge sent: the store then gives its item `clientRequestId = sendUuid`. */
	prompt(sessionId: SessionId, sendUuid: string): PromptRecord | undefined;
	/** Writes to the session's file up to `at` (epoch ms) were this bridge's own: a host that ended, a rename, a fork (D122). */
	noteOwnWrite(sessionId: SessionId, at: number): Promise<void>;
	ownWriteAt(sessionId: SessionId): number | undefined;
}
