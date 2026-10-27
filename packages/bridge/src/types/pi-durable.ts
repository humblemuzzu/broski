import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Cursor } from "@earendil-works/pi-durable";
import type { BroskiSessionSummary } from "./runtime";

export type PiDurableModelRef = {
	provider: string;
	modelId: string;
};

export type PiDurableWhenBusy = "steer" | "followUp";

export type PiDurableCreateSessionMessage = {
	type: "pd_create_session";
	cwd: string;
	model?: PiDurableModelRef;
	thinkingLevel?: ModelThinkingLevel;
	title?: string;
	requestId?: string;
};

export type PiDurableImageInput = {
	data: string;
	mimeType: string;
};

export type PiDurableChatMessage = {
	type: "pd_chat";
	sessionId: string;
	content: string;
	images?: PiDurableImageInput[];
	requestId?: string;
	whenBusy?: PiDurableWhenBusy;
};

export type PiDurableCompactMessage = {
	type: "pd_compact";
	sessionId: string;
	instructions?: string;
	requestId?: string;
};

export type PiDurableGetTranscriptMessage = {
	type: "pd_get_transcript";
	sessionId: string;
	limit?: number;
	cursor?: Cursor;
	requestId?: string;
};

export type PiDurablePermissionResponseMessage = {
	type: "pd_permission_response";
	sessionId: string;
	requestId: string;
	decision: "allow" | "deny";
	reason?: string;
};

export type PiDurableClientMessage =
	| PiDurableCreateSessionMessage
	| PiDurableChatMessage
	| PiDurableCompactMessage
	| PiDurableGetTranscriptMessage
	| PiDurablePermissionResponseMessage;

/** One committed transcript message, in the same shape `connectors/pi/pi-events.ts` emits for the Pi backend. */
export type PiDurableTranscriptEntry = {
	role: string;
	[key: string]: unknown;
};

/**
 * The newest `limit` committed entries, oldest first, plus the cursor for the preceding page. `nextCursor` walks
 * backwards through the transcript, so paging forwards means reading pages in reverse order.
 */
export type PiDurableTranscriptPage = {
	messages: PiDurableTranscriptEntry[];
	nextCursor?: Cursor;
};

export type PiDurableServerMessage =
	| { type: "pd_session_created"; backend: "pi-durable"; data: BroskiSessionSummary; requestId?: string }
	| { type: "pd_chat_accepted"; backend: "pi-durable"; data: { submissionId: number }; requestId?: string }
	| { type: "pd_transcript"; backend: "pi-durable"; data: PiDurableTranscriptPage; requestId?: string }
	| { type: "pd_compacted"; backend: "pi-durable"; data: boolean; requestId?: string }
	| { type: "pd_permission_resolved"; backend: "pi-durable"; data: boolean; requestId?: string };

/** The slice of a Bun socket this backend writes to, narrow enough for a bare collector to satisfy in tests. */
export type PiDurableSocket = {
	/** [requestId] is the reply's own, so a frame the link refuses reaches the caller waiting on it. */
	send(payload: string, requestId?: string): unknown;
};
