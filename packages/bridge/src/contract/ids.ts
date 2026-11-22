import { z } from "zod";
import { MAX_ID_CHARS } from "./limits";

function id() {
	return z.string().min(1).max(MAX_ID_CHARS);
}

export const BACKEND_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const BackendId = z.string().min(1).max(64).regex(BACKEND_ID_PATTERN);
export type BackendId = z.infer<typeof BackendId>;

/** Milliseconds since the Unix epoch. */
export const Timestamp = z.int().nonnegative();
export type Timestamp = z.infer<typeof Timestamp>;

export const SessionId = id();
export type SessionId = z.infer<typeof SessionId>;

export const SessionRef = z.strictObject({ backend: BackendId, sessionId: SessionId });
export type SessionRef = z.infer<typeof SessionRef>;

export const RunId = id();
export type RunId = z.infer<typeof RunId>;

export const MessageId = id();
export type MessageId = z.infer<typeof MessageId>;

export const BlockId = id();
export type BlockId = z.infer<typeof BlockId>;

export const ToolCallId = id();
export type ToolCallId = z.infer<typeof ToolCallId>;

export const InteractionId = id();
export type InteractionId = z.infer<typeof InteractionId>;

export const QueueItemId = id();
export type QueueItemId = z.infer<typeof QueueItemId>;

/** May combine two ids, as a live tool result's `<toolCallId>:result` does. */
export const TranscriptItemId = z
	.string()
	.min(1)
	.max(2 * MAX_ID_CHARS);
export type TranscriptItemId = z.infer<typeof TranscriptItemId>;

export const AttachmentId = id();
export type AttachmentId = z.infer<typeof AttachmentId>;

export const ModelId = id();
export type ModelId = z.infer<typeof ModelId>;

export const CommandId = id();
export type CommandId = z.infer<typeof CommandId>;

/** Minted by the phone for every prompt; the key prompts are de-duplicated by. */
export const ClientRequestId = z.uuid();
export type ClientRequestId = z.infer<typeof ClientRequestId>;
