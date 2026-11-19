import { z } from "zod";
import { Capabilities, SessionCapabilities } from "./capabilities";
import { CatalogEvent } from "./catalog-events";
import { ImageVariant } from "./content";
import { EventEnvelope } from "./events";
import { AttachmentId, BackendId, ModelId, QueueItemId, SessionRef } from "./ids";
import { ActionResult, PromptInput, PromptResult } from "./input";
import { InteractionAnswer } from "./interaction-replies";
import { MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { ModeAxisId } from "./modes";
import { PageRequest } from "./paging";
import { PlanUsageResult } from "./plan-usage";
import { RequestId, request, response } from "./protocol-request";
import {
	FsImageRequest,
	FsImageResponse,
	FsListRequest,
	FsListResponse,
	FsReadRequest,
	FsReadResponse,
	FsSearchRequest,
	FsSearchResponse,
	GitBranchesRequest,
	GitBranchesResponse,
	GitCheckoutRequest,
	GitCheckoutResponse,
	GitCommitRequest,
	GitCommitResponse,
	GitDiffRequest,
	GitDiffResponse,
	GitLogRequest,
	GitLogResponse,
	GitStageRequest,
	GitStageResponse,
	GitStatusRequest,
	GitStatusResponse,
	GitUnstageRequest,
	GitUnstageResponse,
	TermAttachRequest,
	TermAttachResponse,
	TermCloseRequest,
	TermCloseResponse,
	TermDetachRequest,
	TermDetachResponse,
	TermInputRequest,
	TermInputResponse,
	TermListRequest,
	TermListResponse,
	TermOpenRequest,
	TermOpenResponse,
	TermResizeRequest,
	TermResizeResponse,
	WorkspaceInfoRequest,
	WorkspaceInfoResponse,
} from "./protocol-workspace";
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
import { TermExitedMessage, TermOutputMessage } from "./workspace-terminal";

export { RequestId };

/**
 * Bridge and app talk only when `major` is equal. A change the other side cannot ignore bumps `major`; until a
 * client ships, 1.0 changes in place.
 */
export const PROTOCOL_VERSION = { major: 1, minor: 0 } as const;

export const ProtocolVersion = z.strictObject({ major: z.int().nonnegative(), minor: z.int().nonnegative() });
export type ProtocolVersion = z.infer<typeof ProtocolVersion>;

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
 * are those of `session`, which the client attaches to next.
 */
export const ReplacedSync = z.strictObject({
	kind: z.literal("replaced"),
	epoch: StreamEpoch,
	session: SessionRef,
});
export type ReplacedSync = z.infer<typeof ReplacedSync>;

export const AttachSync = z.discriminatedUnion("kind", [ReplaySync, SnapshotSync, ReplacedSync]);
export type AttachSync = z.infer<typeof AttachSync>;

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
/** Without `resume`, or when the bridge cannot replay from it, the response carries a snapshot. */
export const SessionAttachRequest = request("session.attach", {
	session: SessionRef,
	resume: StreamPosition.optional(),
});
export const SessionDetachRequest = request("session.detach", { session: SessionRef });
export const TranscriptReadRequest = request("transcript.read", { session: SessionRef, page: PageRequest });
export const AttachmentReadRequest = request("attachment.read", {
	session: SessionRef,
	attachmentId: AttachmentId,
	variant: ImageVariant.optional(),
});
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
/** How much of each subscription plan signed in on the machine is used; the bridge reads it, not an agent. */
export const PlanUsageRequest = request("plan.usage", {});

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
	PlanUsageRequest,
	WorkspaceInfoRequest,
	FsListRequest,
	FsReadRequest,
	FsImageRequest,
	FsSearchRequest,
	GitStatusRequest,
	GitDiffRequest,
	GitStageRequest,
	GitUnstageRequest,
	GitCommitRequest,
	GitBranchesRequest,
	GitCheckoutRequest,
	GitLogRequest,
	TermListRequest,
	TermOpenRequest,
	TermAttachRequest,
	TermDetachRequest,
	TermInputRequest,
	TermResizeRequest,
	TermCloseRequest,
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
export const PlanUsageResponse = response("plan.usage", { result: PlanUsageResult });

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
	PlanUsageResponse,
	WorkspaceInfoResponse,
	FsListResponse,
	FsReadResponse,
	FsImageResponse,
	FsSearchResponse,
	GitStatusResponse,
	GitDiffResponse,
	GitStageResponse,
	GitUnstageResponse,
	GitCommitResponse,
	GitBranchesResponse,
	GitCheckoutResponse,
	GitLogResponse,
	TermListResponse,
	TermOpenResponse,
	TermAttachResponse,
	TermDetachResponse,
	TermInputResponse,
	TermResizeResponse,
	TermCloseResponse,
	ErrorResponse,
	EventMessage,
	CatalogMessage,
	TermOutputMessage,
	TermExitedMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** The response that answers a request of type `T`. */
export type ResponseFor<T extends ClientMessage["type"]> = Extract<ServerMessage, { type: `${T}.result` }>;
