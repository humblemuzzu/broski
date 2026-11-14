import { z } from "zod";
import { ModelId, SessionRef, Timestamp, TranscriptItemId } from "./ids";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS } from "./limits";
import { ModeSetting } from "./modes";
import { MAX_PAGE_LIMIT, PageCursor } from "./paging";
import { Rejected } from "./rejection";

/** `unknown`: the backend cannot tell, as for a terminal session it only reads from disk. */
export const SessionStatus = z.enum(["idle", "running", "waiting_for_user", "unknown"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** `first_prompt`: no title was set or generated, so the first prompt stands in. */
export const TitleSource = z.enum(["user", "generated", "first_prompt"]);
export type TitleSource = z.infer<typeof TitleSource>;

export const SessionTitle = z.strictObject({ text: z.string().min(1).max(MAX_NAME_CHARS), source: TitleSource });
export type SessionTitle = z.infer<typeof SessionTitle>;

export const ParentKind = z.enum(["fork", "subagent"]);
export type ParentKind = z.infer<typeof ParentKind>;

export const SessionParent = z.strictObject({ kind: ParentKind, session: SessionRef });
export type SessionParent = z.infer<typeof SessionParent>;

/** `external`: created by another client of the backend, such as its terminal UI. */
export const SessionOrigin = z.enum(["broski", "external"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const WorkingDirectory = z.string().min(1).max(MAX_PATH_CHARS);
export type WorkingDirectory = z.infer<typeof WorkingDirectory>;

export const SessionSummary = z.strictObject({
	session: SessionRef,
	title: SessionTitle.optional(),
	cwd: WorkingDirectory.optional(),
	createdAt: Timestamp.optional(),
	updatedAt: Timestamp,
	parent: SessionParent.optional(),
	modelId: ModelId.optional(),
	status: SessionStatus,
	origin: SessionOrigin,
	/** The backend's own name for the client that created it, such as `cli` or `vscode`. */
	source: z.string().max(MAX_NAME_CHARS).optional(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Newest updated first. `parent` lists that session's children. */
export const SessionQuery = z.strictObject({
	cwd: WorkingDirectory.optional(),
	parent: SessionRef.optional(),
});
export type SessionQuery = z.infer<typeof SessionQuery>;

export const SessionPage = z.strictObject({
	items: z.array(SessionSummary).max(MAX_PAGE_LIMIT),
	nextCursor: PageCursor.optional(),
});
export type SessionPage = z.infer<typeof SessionPage>;

/** `modes` sets some of the session's modes at creation; the rest take the backend's defaults. */
export const NewSessionOptions = z.strictObject({
	cwd: WorkingDirectory,
	modelId: ModelId.optional(),
	thinking: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	modes: z.array(ModeSetting).max(MAX_LIST_ITEMS).optional(),
});
export type NewSessionOptions = z.infer<typeof NewSessionOptions>;

/** `before`: the fork ends just before the item. `through`: it includes the item. */
export const ForkPosition = z.enum(["before", "through"]);
export type ForkPosition = z.infer<typeof ForkPosition>;

export const ForkPoint = z.strictObject({ itemId: TranscriptItemId, position: ForkPosition });
export type ForkPoint = z.infer<typeof ForkPoint>;

export const NewSessionAccepted = z.strictObject({ status: z.literal("accepted"), session: SessionRef });
export type NewSessionAccepted = z.infer<typeof NewSessionAccepted>;

/** The answer to creating or forking a session. */
export const NewSessionResult = z.discriminatedUnion("status", [NewSessionAccepted, Rejected]);
export type NewSessionResult = z.infer<typeof NewSessionResult>;
