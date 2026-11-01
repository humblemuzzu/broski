import { z } from "zod";
import { BackendCall, BackendCallResult } from "./backend-ops";
import { Capabilities, SessionCapabilities } from "./capabilities";
import { CatalogEvent } from "./catalog-events";
import { EventEnvelope } from "./events";
import { AttachmentId, BackendId, ModelId, QueueItemId, SessionRef } from "./ids";
import { ActionResult, PromptInput, PromptResult } from "./input";
import { InteractionAnswer } from "./interaction-replies";
import { MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { ModeAxisId } from "./modes";
import { PageRequest } from "./paging";
import {
	AttachmentReadResult,
	CommandsListResult,
	ModelsListResult,
	ModesListResult,
	SessionGetResult,
	SessionsListResult,
	TranscriptReadResult,
} from "./read-results";
import { ForkPoint, NewSessionOptions, NewSessionResult, SessionQuery, WorkingDirectory } from "./sessions";
import { SessionSnapshot } from "./snapshot";
import { BackendStatus } from "./status";

/**
 * Bridge and app talk only when `major` is equal. A change the older side can ignore (a new optional
 * field, a new request, a new union member or enum value) bumps `minor`; anything else bumps `major`.
 * Neither side sends the other anything newer than the other's `minor`, learnt from `hello`.
 */
export const PROTOCOL_VERSION = { major: 1, minor: 4 } as const;

/**
 * The minor that introduced each addition to 1.0. The bridge sends it only to a client whose `hello`
 * named at least that minor (`CoreClient.speaks`). 1.1: the `replaced` attach answer. 1.2: the
 * `input_returned` event (an older client is sent a `notice` with the same texts in its place) and the
 * `take_over` Pi op (an older client is not told it exists). 1.3: `sessionControls`, the `compaction.cancel` and
 * `retry.cancel` requests with the `SessionCapabilities` fields that announce them, and the Pi ops `session_settings`,
 * `session_tools` and `system_prompt`; `sessionFiles` and `modelAvailability`, the Pi session-file ops,
 * `refresh_models` and the unavailable models of a model list; `treeOps` and `shellOps`, the Pi tree ops
 * (`read_tree`, `label_entry`, `abort_branch_summary`) and `run_shell`. 1.4: `configOps`, the ops of a project's
 * configuration, a session's lists and the bridge's own tools (`config_files`, `config_file`, `settings_overview`,
 * `mcp_servers`, `plugins`, `tasks`, `context_usage`, `custom_tools`, `custom_tool`), Claude Code serving the existing
 * `session_settings`, `changed_files` and `refresh_models`, the `prompt_suggestion` extension (an older client is sent a
 * `notice` in its place), and a plan approval's next mode (`modeOptions`, `modeAfter`: an older client is sent the plan
 * without the options, and its answer may not name one). An older client is told of none of them.
 */
export const ADDED_IN_MINOR = {
	replacedSync: 1,
	inputReturned: 2,
	takeOver: 2,
	sessionControls: 3,
	sessionFiles: 3,
	modelAvailability: 3,
	treeOps: 3,
	shellOps: 3,
	configOps: 4,
} as const;

export const ProtocolVersion = z.strictObject({ major: z.int().nonnegative(), minor: z.int().nonnegative() });
export type ProtocolVersion = z.infer<typeof ProtocolVersion>;

/** Chosen by the client; the response carries it back. */
export const RequestId = z.string().min(1).max(128);
export type RequestId = z.infer<typeof RequestId>;

export const ClientInfo = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	version: z.string().min(1).max(MAX_NAME_CHARS),
});
export type ClientInfo = z.infer<typeof ClientInfo>;

export const BackendDescriptor = z.strictObject({ id: BackendId, capabilities: Capabilities });
export type BackendDescriptor = z.infer<typeof BackendDescriptor>;

/** Changes whenever the bridge starts a session's event stream afresh. */
export const StreamEpoch = z.string().min(1).max(MAX_ID_CHARS);
export type StreamEpoch = z.infer<typeof StreamEpoch>;

export const StreamPosition = z.strictObject({ epoch: StreamEpoch, seq: z.int().nonnegative() });
export type StreamPosition = z.infer<typeof StreamPosition>;

/** Events with `seq` above `afterSeq` follow as `event` messages. */
export const ReplaySync = z.strictObject({
	kind: z.literal("replay"),
	epoch: StreamEpoch,
	afterSeq: z.int().nonnegative(),
});
export type ReplaySync = z.infer<typeof ReplaySync>;

/** The live state after event `lastSeq`; events from `lastSeq + 1` follow. */
export const SnapshotSync = z.strictObject({
	kind: z.literal("snapshot"),
	epoch: StreamEpoch,
	lastSeq: z.int().nonnegative(),
	snapshot: SessionSnapshot,
});
export type SnapshotSync = z.infer<typeof SnapshotSync>;

/**
 * The stream `epoch` ended in `session_replaced`, and its conversation goes on as `session` (after
 * any further replacement). The client is attached to neither session; the answer's `capabilities`
 * are those of `session`, which the client attaches to next. Sent only to a client of minor 1 or
 * later; an older one is attached to the session it named, as before.
 */
export const ReplacedSync = z.strictObject({
	kind: z.literal("replaced"),
	epoch: StreamEpoch,
	session: SessionRef,
});
export type ReplacedSync = z.infer<typeof ReplacedSync>;

export const AttachSync = z.discriminatedUnion("kind", [ReplaySync, SnapshotSync, ReplacedSync]);
export type AttachSync = z.infer<typeof AttachSync>;

function request<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
	return z.strictObject({ type: z.literal(type), requestId: RequestId, ...shape });
}

function response<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
	return z.strictObject({ type: z.literal(`${type}.result`), requestId: RequestId, ...shape });
}

export const HelloRequest = request("hello", { protocol: ProtocolVersion, client: ClientInfo });
export const BackendsListRequest = request("backends.list", {});
export const BackendStatusRequest = request("backend.status", { backend: BackendId });
export const ModelsListRequest = request("models.list", {
	backend: BackendId,
	cwd: WorkingDirectory.optional(),
	includeUnavailable: z.boolean().optional(),
});
export const CommandsListRequest = request("commands.list", {
	backend: BackendId,
	cwd: WorkingDirectory.optional(),
	session: SessionRef.optional(),
});
export const ModesListRequest = request("modes.list", { backend: BackendId, cwd: WorkingDirectory.optional() });
export const SessionsListRequest = request("sessions.list", {
	backend: BackendId,
	query: SessionQuery,
	page: PageRequest,
});
export const SessionGetRequest = request("session.get", { session: SessionRef });
export const SessionCreateRequest = request("session.create", { backend: BackendId, options: NewSessionOptions });
export const SessionForkRequest = request("session.fork", { session: SessionRef, at: ForkPoint.optional() });
export const SessionRenameRequest = request("session.rename", {
	session: SessionRef,
	title: z.string().min(1).max(MAX_NAME_CHARS),
});
export const SessionDeleteRequest = request("session.delete", { session: SessionRef });
export const SessionArchiveRequest = request("session.archive", { session: SessionRef, archived: z.boolean() });
/** Without `resume`, or when the bridge cannot replay from it, the response carries a snapshot. */
export const SessionAttachRequest = request("session.attach", {
	session: SessionRef,
	resume: StreamPosition.optional(),
});
export const SessionDetachRequest = request("session.detach", { session: SessionRef });
export const TranscriptReadRequest = request("transcript.read", { session: SessionRef, page: PageRequest });
export const AttachmentReadRequest = request("attachment.read", { session: SessionRef, attachmentId: AttachmentId });
export const PromptRequest = request("prompt", { session: SessionRef, input: PromptInput });
export const AbortRequest = request("abort", { session: SessionRef });
export const InteractionAnswerRequest = request("interaction.answer", {
	session: SessionRef,
	answer: InteractionAnswer,
});
export const QueueCancelRequest = request("queue.cancel", { session: SessionRef, queueItemId: QueueItemId });
export const ModelSetRequest = request("model.set", { session: SessionRef, modelId: ModelId });
export const ThinkingSetRequest = request("thinking.set", {
	session: SessionRef,
	thinking: z.string().min(1).max(MAX_NAME_CHARS),
});
export const ModeSetRequest = request("mode.set", {
	session: SessionRef,
	axis: ModeAxisId,
	value: z.string().max(MAX_NAME_CHARS),
});
export const CompactRequest = request("compact", {
	session: SessionRef,
	instructions: z.string().min(1).max(MAX_TEXT_CHARS).optional(),
});
export const CompactionCancelRequest = request("compaction.cancel", { session: SessionRef });
export const RetryCancelRequest = request("retry.cancel", { session: SessionRef });
export const BackendCallRequest = request("backend.call", { call: BackendCall });

export const ClientMessage = z.discriminatedUnion("type", [
	HelloRequest,
	BackendsListRequest,
	BackendStatusRequest,
	ModelsListRequest,
	CommandsListRequest,
	ModesListRequest,
	SessionsListRequest,
	SessionGetRequest,
	SessionCreateRequest,
	SessionForkRequest,
	SessionRenameRequest,
	SessionDeleteRequest,
	SessionArchiveRequest,
	SessionAttachRequest,
	SessionDetachRequest,
	TranscriptReadRequest,
	AttachmentReadRequest,
	PromptRequest,
	AbortRequest,
	InteractionAnswerRequest,
	QueueCancelRequest,
	ModelSetRequest,
	ThinkingSetRequest,
	ModeSetRequest,
	CompactRequest,
	CompactionCancelRequest,
	RetryCancelRequest,
	BackendCallRequest,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const HelloResponse = response("hello", {
	protocol: ProtocolVersion,
	bridgeVersion: z.string().min(1).max(MAX_NAME_CHARS),
});
export const BackendsListResponse = response("backends.list", {
	backends: z.array(BackendDescriptor).max(BackendId.options.length),
});
export const BackendStatusResponse = response("backend.status", { status: BackendStatus });
export const ModelsListResponse = response("models.list", { result: ModelsListResult });
export const CommandsListResponse = response("commands.list", { result: CommandsListResult });
export const ModesListResponse = response("modes.list", { result: ModesListResult });
export const SessionsListResponse = response("sessions.list", { result: SessionsListResult });
export const SessionGetResponse = response("session.get", { result: SessionGetResult });
export const SessionCreateResponse = response("session.create", { result: NewSessionResult });
export const SessionForkResponse = response("session.fork", { result: NewSessionResult });
export const SessionRenameResponse = response("session.rename", { result: ActionResult });
export const SessionDeleteResponse = response("session.delete", { result: ActionResult });
export const SessionArchiveResponse = response("session.archive", { result: ActionResult });
export const SessionAttachResponse = response("session.attach", {
	capabilities: SessionCapabilities,
	sync: AttachSync,
});
export const SessionDetachResponse = response("session.detach", {});
export const TranscriptReadResponse = response("transcript.read", { result: TranscriptReadResult });
export const AttachmentReadResponse = response("attachment.read", { result: AttachmentReadResult });
export const PromptResponse = response("prompt", { result: PromptResult });
export const AbortResponse = response("abort", { result: ActionResult });
export const InteractionAnswerResponse = response("interaction.answer", { result: ActionResult });
export const QueueCancelResponse = response("queue.cancel", { result: ActionResult });
export const ModelSetResponse = response("model.set", { result: ActionResult });
export const ThinkingSetResponse = response("thinking.set", { result: ActionResult });
export const ModeSetResponse = response("mode.set", { result: ActionResult });
export const CompactResponse = response("compact", { result: ActionResult });
export const CompactionCancelResponse = response("compaction.cancel", { result: ActionResult });
export const RetryCancelResponse = response("retry.cancel", { result: ActionResult });
export const BackendCallResponse = response("backend.call", { result: BackendCallResult });

/**
 * A request the bridge could not handle at all. Expected outcomes, including an operation the
 * backend does not support, are results inside the matching response instead.
 */
export const ProtocolErrorCode = z.enum([
	"invalid_message",
	"unsupported_version",
	"unknown_backend",
	"unknown_session",
	"not_attached",
	"rate_limited",
	"internal",
]);
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCode>;

export const ProtocolError = z.strictObject({ code: ProtocolErrorCode, message: z.string().max(MAX_TEXT_CHARS) });
export type ProtocolError = z.infer<typeof ProtocolError>;

/** `requestId` is absent when the message carried none the bridge could read. */
export const ErrorResponse = z.strictObject({
	type: z.literal("error"),
	requestId: RequestId.optional(),
	error: ProtocolError,
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const EventMessage = z.strictObject({ type: z.literal("event"), envelope: EventEnvelope });
export type EventMessage = z.infer<typeof EventMessage>;

export const CatalogMessage = z.strictObject({ type: z.literal("catalog"), backend: BackendId, event: CatalogEvent });
export type CatalogMessage = z.infer<typeof CatalogMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
	HelloResponse,
	BackendsListResponse,
	BackendStatusResponse,
	ModelsListResponse,
	CommandsListResponse,
	ModesListResponse,
	SessionsListResponse,
	SessionGetResponse,
	SessionCreateResponse,
	SessionForkResponse,
	SessionRenameResponse,
	SessionDeleteResponse,
	SessionArchiveResponse,
	SessionAttachResponse,
	SessionDetachResponse,
	TranscriptReadResponse,
	AttachmentReadResponse,
	PromptResponse,
	AbortResponse,
	InteractionAnswerResponse,
	QueueCancelResponse,
	ModelSetResponse,
	ThinkingSetResponse,
	ModeSetResponse,
	CompactResponse,
	CompactionCancelResponse,
	RetryCancelResponse,
	BackendCallResponse,
	ErrorResponse,
	EventMessage,
	CatalogMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** The response that answers a request of type `T`. */
export type ResponseFor<T extends ClientMessage["type"]> = Extract<ServerMessage, { type: `${T}.result` }>;
