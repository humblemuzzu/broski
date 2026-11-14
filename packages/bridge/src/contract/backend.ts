import type { Capabilities, SessionCapabilities } from "./capabilities";
import type { CatalogEvent } from "./catalog-events";
import type { EventEnvelope } from "./events";
import type { AttachmentId, BackendId, ModelId, QueueItemId, SessionRef } from "./ids";
import type { ActionResult, PromptInput, PromptResult } from "./input";
import type { InteractionAnswer } from "./interaction-replies";
import type { ModeAxisId } from "./modes";
import type { PageRequest } from "./paging";
import type {
	AttachmentReadResult,
	CommandsListResult,
	ModelsListResult,
	ModesListResult,
	SessionGetResult,
	SessionsListResult,
	TranscriptReadResult,
} from "./read-results";
import type { Rejected } from "./rejection";
import type { ForkPoint, NewSessionOptions, NewSessionResult, SessionQuery } from "./sessions";
import type { SessionSnapshot } from "./snapshot";
import type { BackendStatus } from "./status";

/** Backend-wide news for the core. `emit` never throws. */
export interface CatalogSink {
	emit(event: CatalogEvent): void;
}

/** `includeUnavailable`: also the models the backend knows but cannot use now, each with its `unavailableReason`. */
export interface ModelListOptions {
	readonly includeUnavailable?: boolean;
}

/** An event as an adapter emits it; the core adds the session and `seq`. */
export type SinkRecord = Omit<EventEnvelope, "seq" | "session">;

/** The only way an open session reports what happens in it. `emit` never throws. */
export interface SessionSink {
	emit(record: SinkRecord): void;
}

export interface BackendHost {
	readonly catalog: CatalogSink;
}

export type BackendFactory = (host: BackendHost) => Promise<AgentBackend>;

/** The capabilities an adapter declares; the rest are derived from the methods it implements. */
export type BackendTraits = Omit<Capabilities, "fork" | "rename" | "delete">;

export type OpenTarget = { kind: "existing"; session: SessionRef } | { kind: "new"; options: NewSessionOptions };

/**
 * `snapshot` is the live state at the moment `open` resolves. Nothing is emitted into the sink
 * before that moment, and everything emitted after it applies on top of `snapshot`.
 */
export type OpenResult = { status: "accepted"; session: OpenSession; snapshot: SessionSnapshot } | Rejected;

/**
 * One backend, long-lived. Methods return expected failures as `Rejected`; a thrown error is an
 * adapter bug. An optional method that is absent is a capability the backend does not have.
 */
export interface AgentBackend {
	readonly id: BackendId;
	readonly traits: BackendTraits;
	status(): Promise<BackendStatus>;
	/** Rejected `invalid_input` for a cursor this adapter did not mint. */
	listSessions(query: SessionQuery, page: PageRequest): Promise<SessionsListResult>;
	getSession(session: SessionRef): Promise<SessionGetResult>;
	/** Finished runs only: while an open session has an active run, its items are in `run.items` instead. */
	readTranscript(session: SessionRef, page: PageRequest): Promise<TranscriptReadResult>;
	/** The bytes behind an `ImageRef` the session's events or transcript named. */
	readAttachment(session: SessionRef, attachment: AttachmentId): Promise<AttachmentReadResult>;
	listModels(cwd: string | undefined, options?: ModelListOptions): Promise<ModelsListResult>;
	listCommands(scope: { cwd?: string; session?: SessionRef }): Promise<CommandsListResult>;
	listModes(cwd: string | undefined): Promise<ModesListResult>;
	open(target: OpenTarget, sink: SessionSink): Promise<OpenResult>;
	rename?(session: SessionRef, title: string): Promise<ActionResult>;
	delete?(session: SessionRef): Promise<ActionResult>;
	fork?(session: SessionRef, at: ForkPoint | undefined): Promise<NewSessionResult>;
	/** Closes every open session; nothing is emitted afterwards. */
	dispose(): Promise<void>;
}

export interface OpenSession {
	/** The session's identity now; a `session_replaced` event changes it. */
	readonly session: SessionRef;
	/** The live state now: the open snapshot with every event emitted since applied (`applyEvent`). */
	snapshot(): SessionSnapshot;
	/** Absent for a session that can only be watched. */
	readonly control?: SessionControl;
	/**
	 * Only on a session without `control` whose asks can still be answered here, such as a terminal's
	 * permission prompt; a session with `control` answers through `control.answer` and has no `answer`.
	 */
	answer?(answer: InteractionAnswer): Promise<ActionResult>;
	/**
	 * Detaches the sink: from the call on nothing is emitted, and `control` methods and `answer` reject `closed`.
	 * Aborts nothing; a run in progress goes on in the backend, and an ask it raises waits for the
	 * next `open`. Calling it again does nothing.
	 */
	close(): Promise<void>;
}

export interface SessionControl {
	/**
	 * Idempotent per `clientRequestId`: a repeat of an accepted prompt returns the first result and does
	 * nothing else. A rejection is not remembered, so the same id may be sent again once the cause is gone.
	 */
	prompt(input: PromptInput): Promise<PromptResult>;
	/** Ends the active run; accepted and without effect when there is none. */
	abort(): Promise<ActionResult>;
	answer(answer: InteractionAnswer): Promise<ActionResult>;
	/** Rejected `not_found` for a model `listModels` does not offer. */
	setModel(modelId: ModelId): Promise<ActionResult>;
	/** `value` must be one of the current model's `ThinkingSpec` option values. */
	setThinking(value: string): Promise<ActionResult>;
	/** `value` must be one of the axis's option values. */
	setMode(axis: ModeAxisId, value: string): Promise<ActionResult>;
	compact?(instructions: string | undefined): Promise<ActionResult>;
	cancelQueued?(id: QueueItemId): Promise<ActionResult>;
}

export function backendCapabilities(backend: AgentBackend): Capabilities {
	return {
		...backend.traits,
		fork: backend.fork !== undefined,
		rename: backend.rename !== undefined,
		delete: backend.delete !== undefined,
	};
}

/** What takes answers to a session's asks. */
export interface SessionAnswerer {
	answer(answer: InteractionAnswer): Promise<ActionResult>;
}

/** The session's `control`, or the session itself when it answers without control; undefined when nothing answers. */
export function sessionAnswerer(session: OpenSession): SessionAnswerer | undefined {
	if (session.control) return session.control;
	return answersWithoutControl(session) ? session : undefined;
}

function answersWithoutControl(session: OpenSession): session is OpenSession & SessionAnswerer {
	return session.answer !== undefined;
}

export function sessionCapabilities(session: OpenSession): SessionCapabilities {
	return {
		controllable: session.control !== undefined,
		compact: session.control?.compact !== undefined,
		cancelQueued: session.control?.cancelQueued !== undefined,
		answer: sessionAnswerer(session) !== undefined,
	};
}
