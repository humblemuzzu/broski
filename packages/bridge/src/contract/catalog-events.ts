import { z } from "zod";
import { SessionRef } from "./ids";
import { SessionSummary } from "./sessions";
import { BackendStatus } from "./status";

/** A session list row changed or appeared; replaces the row with the same `session`. */
export const SessionUpdatedEvent = z.strictObject({ type: z.literal("session_updated"), summary: SessionSummary });
export type SessionUpdatedEvent = z.infer<typeof SessionUpdatedEvent>;

export const SessionRemovedEvent = z.strictObject({ type: z.literal("session_removed"), session: SessionRef });
export type SessionRemovedEvent = z.infer<typeof SessionRemovedEvent>;

export const StatusChangedEvent = z.strictObject({ type: z.literal("status_changed"), status: BackendStatus });
export type StatusChangedEvent = z.infer<typeof StatusChangedEvent>;

export const CatalogScope = z.enum(["models", "commands", "modes"]);
export type CatalogScope = z.infer<typeof CatalogScope>;

/** A list the app caches is stale and must be fetched again. */
export const CatalogInvalidatedEvent = z.strictObject({ type: z.literal("catalog_invalidated"), scope: CatalogScope });
export type CatalogInvalidatedEvent = z.infer<typeof CatalogInvalidatedEvent>;

/** The session's history was rewritten, as a revert does; every page read before is stale. */
export const TranscriptInvalidatedEvent = z.strictObject({
	type: z.literal("transcript_invalidated"),
	session: SessionRef,
});
export type TranscriptInvalidatedEvent = z.infer<typeof TranscriptInvalidatedEvent>;

/** Backend-wide news, not tied to an open session. */
export const CatalogEvent = z.discriminatedUnion("type", [
	SessionUpdatedEvent,
	SessionRemovedEvent,
	StatusChangedEvent,
	CatalogInvalidatedEvent,
	TranscriptInvalidatedEvent,
]);
export type CatalogEvent = z.infer<typeof CatalogEvent>;
