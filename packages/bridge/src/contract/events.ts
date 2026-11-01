import { z } from "zod";
import { Activity } from "./activity";
import { CompactionOutcome, CompactionTrigger } from "./compaction";
import { AttachmentRef, BlockKind } from "./content";
import { BackendExtension } from "./extensions";
import {
	BlockId,
	ClientRequestId,
	InteractionId,
	MessageId,
	ModelId,
	RunId,
	SessionRef,
	Timestamp,
	ToolCallId,
} from "./ids";
import { ResolutionReason } from "./interaction-replies";
import { Interaction } from "./interactions";
import { JsonValue, NativeIds } from "./json";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { ModeSetting } from "./modes";
import { NoticeLevel } from "./notice";
import { Plan } from "./plan";
import { QueueItem } from "./queue";
import { ErrorInfo, RunOutcome, RunTrigger } from "./runs";
import { SessionSnapshot } from "./snapshot";
import { ToolOutcome, ToolResult, ToolUpdate } from "./tools";
import { Usage } from "./usage";

export const RunStartedEvent = z.strictObject({ type: z.literal("run_started"), runId: RunId, trigger: RunTrigger });
export type RunStartedEvent = z.infer<typeof RunStartedEvent>;

/** The run will not continue on its own. Exactly one per `run_started`. */
export const RunFinishedEvent = z.strictObject({
	type: z.literal("run_finished"),
	runId: RunId,
	outcome: RunOutcome,
});
export type RunFinishedEvent = z.infer<typeof RunFinishedEvent>;

/** User input reaching the model, including steered and queued input when it is delivered. */
export const UserMessageEvent = z.strictObject({
	type: z.literal("user_message"),
	messageId: MessageId,
	text: z.string().max(MAX_TEXT_CHARS),
	attachments: z.array(AttachmentRef).max(MAX_LIST_ITEMS),
	clientRequestId: ClientRequestId.optional(),
});
export type UserMessageEvent = z.infer<typeof UserMessageEvent>;

export const BlockStartedEvent = z.strictObject({
	type: z.literal("block_started"),
	blockId: BlockId,
	messageId: MessageId,
	kind: BlockKind,
	/** Set for a subagent's block streamed inside the parent's run. */
	parentToolCallId: ToolCallId.optional(),
});
export type BlockStartedEvent = z.infer<typeof BlockStartedEvent>;

export const BlockDeltaEvent = z.strictObject({
	type: z.literal("block_delta"),
	blockId: BlockId,
	text: z.string().max(MAX_TEXT_CHARS),
});
export type BlockDeltaEvent = z.infer<typeof BlockDeltaEvent>;

/** `text` is the block's whole, authoritative text and replaces whatever deltas built. */
export const BlockFinishedEvent = z.strictObject({
	type: z.literal("block_finished"),
	blockId: BlockId,
	text: z.string().max(MAX_TEXT_CHARS),
});
export type BlockFinishedEvent = z.infer<typeof BlockFinishedEvent>;

/** `input` is absent while the backend is still streaming the arguments; a `ToolInputSet` update delivers them. */
export const ToolStartedEvent = z.strictObject({
	type: z.literal("tool_started"),
	toolCallId: ToolCallId,
	name: z.string().min(1).max(MAX_NAME_CHARS),
	title: z.string().max(MAX_NAME_CHARS).optional(),
	input: JsonValue.optional(),
	messageId: MessageId.optional(),
	parentToolCallId: ToolCallId.optional(),
});
export type ToolStartedEvent = z.infer<typeof ToolStartedEvent>;

export const ToolUpdatedEvent = z.strictObject({
	type: z.literal("tool_updated"),
	toolCallId: ToolCallId,
	update: ToolUpdate,
});
export type ToolUpdatedEvent = z.infer<typeof ToolUpdatedEvent>;

export const ToolFinishedEvent = z.strictObject({
	type: z.literal("tool_finished"),
	toolCallId: ToolCallId,
	outcome: ToolOutcome,
	result: ToolResult,
});
export type ToolFinishedEvent = z.infer<typeof ToolFinishedEvent>;

export const InteractionRequestedEvent = z.strictObject({
	type: z.literal("interaction_requested"),
	interaction: Interaction,
});
export type InteractionRequestedEvent = z.infer<typeof InteractionRequestedEvent>;

/** Exactly one per `interaction_requested`. */
export const InteractionResolvedEvent = z.strictObject({
	type: z.literal("interaction_resolved"),
	interactionId: InteractionId,
	reason: ResolutionReason,
});
export type InteractionResolvedEvent = z.infer<typeof InteractionResolvedEvent>;

/** The whole queue, replacing the previous one. */
export const QueueChangedEvent = z.strictObject({
	type: z.literal("queue_changed"),
	items: z.array(QueueItem).max(MAX_LIST_ITEMS),
});
export type QueueChangedEvent = z.infer<typeof QueueChangedEvent>;

export const CompactionStartedEvent = z.strictObject({
	type: z.literal("compaction_started"),
	trigger: CompactionTrigger,
});
export type CompactionStartedEvent = z.infer<typeof CompactionStartedEvent>;

export const CompactionFinishedEvent = z.strictObject({
	type: z.literal("compaction_finished"),
	outcome: CompactionOutcome,
});
export type CompactionFinishedEvent = z.infer<typeof CompactionFinishedEvent>;

export const RetryScheduledEvent = z.strictObject({
	type: z.literal("retry_scheduled"),
	attempt: z.int().positive(),
	maxAttempts: z.int().positive().optional(),
	retryAt: Timestamp.optional(),
	message: z.string().max(MAX_TEXT_CHARS),
});
export type RetryScheduledEvent = z.infer<typeof RetryScheduledEvent>;

export const RetryFinishedEvent = z.strictObject({ type: z.literal("retry_finished"), succeeded: z.boolean() });
export type RetryFinishedEvent = z.infer<typeof RetryFinishedEvent>;

export const UsageUpdatedEvent = z.strictObject({ type: z.literal("usage_updated"), usage: Usage });
export type UsageUpdatedEvent = z.infer<typeof UsageUpdatedEvent>;

export const PlanUpdatedEvent = z.strictObject({ type: z.literal("plan_updated"), plan: Plan });
export type PlanUpdatedEvent = z.infer<typeof PlanUpdatedEvent>;

/** These messages, with their blocks and tool calls, were withdrawn by the backend and must disappear from the view. */
export const MessagesRetractedEvent = z.strictObject({
	type: z.literal("messages_retracted"),
	messageIds: z.array(MessageId).min(1).max(MAX_LIST_ITEMS),
});
export type MessagesRetractedEvent = z.infer<typeof MessagesRetractedEvent>;

/**
 * Queued input the backend took back out of its queue, to be put into the composer of the session: the person
 * stopped the run, and what they had queued behind it was not sent. In queue order, steering input first. The
 * queue itself is `queue_changed`; this event only says what to give back, and is not state (since minor 2, `ADDED_IN_MINOR`).
 */
export const InputReturnedEvent = z.strictObject({
	type: z.literal("input_returned"),
	texts: z.array(z.string().min(1).max(MAX_TEXT_CHARS)).min(1).max(MAX_LIST_ITEMS),
});
export type InputReturnedEvent = z.infer<typeof InputReturnedEvent>;

/** The session's model and thinking setting, both replaced. */
export const ModelChangedEvent = z.strictObject({
	type: z.literal("model_changed"),
	modelId: ModelId.optional(),
	thinking: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ModelChangedEvent = z.infer<typeof ModelChangedEvent>;

/** One of the session's modes now has `value`. */
export const ModeChangedEvent = z.strictObject({ type: z.literal("mode_changed"), ...ModeSetting.shape });
export type ModeChangedEvent = z.infer<typeof ModeChangedEvent>;

export const NoticeEvent = z.strictObject({
	type: z.literal("notice"),
	level: NoticeLevel,
	text: z.string().max(MAX_TEXT_CHARS),
});
export type NoticeEvent = z.infer<typeof NoticeEvent>;

/**
 * A harness activity inside the active run started or changed; one with the same `id` is replaced. Not state outside
 * a run. A client below 1.4 is sent a `notice` with the same `seq` instead.
 */
export const ActivityEvent = z.strictObject({ type: z.literal("activity"), activity: Activity });
export type ActivityEvent = z.infer<typeof ActivityEvent>;

/** A failure outside any run's outcome, such as the connection to the backend dropping. */
export const ErrorEvent = z.strictObject({ type: z.literal("error"), error: ErrorInfo, retryable: z.boolean() });
export type ErrorEvent = z.infer<typeof ErrorEvent>;

export const ExtensionEvent = z.strictObject({ type: z.literal("extension"), extension: BackendExtension });
export type ExtensionEvent = z.infer<typeof ExtensionEvent>;

/**
 * The live session goes on as `session`: the backend began a new conversation inside it, as Claude
 * Code's `/clear` does. The previous session keeps its history and is no longer live.
 */
export const SessionReplacedEvent = z.strictObject({ type: z.literal("session_replaced"), session: SessionRef });
export type SessionReplacedEvent = z.infer<typeof SessionReplacedEvent>;

/** Everything known about the session's live state is replaced by `snapshot`. */
export const ResyncedEvent = z.strictObject({ type: z.literal("resynced"), snapshot: SessionSnapshot });
export type ResyncedEvent = z.infer<typeof ResyncedEvent>;

export const AgentEvent = z.discriminatedUnion("type", [
	RunStartedEvent,
	RunFinishedEvent,
	UserMessageEvent,
	BlockStartedEvent,
	BlockDeltaEvent,
	BlockFinishedEvent,
	ToolStartedEvent,
	ToolUpdatedEvent,
	ToolFinishedEvent,
	InteractionRequestedEvent,
	InteractionResolvedEvent,
	QueueChangedEvent,
	InputReturnedEvent,
	CompactionStartedEvent,
	CompactionFinishedEvent,
	RetryScheduledEvent,
	RetryFinishedEvent,
	UsageUpdatedEvent,
	PlanUpdatedEvent,
	MessagesRetractedEvent,
	ModelChangedEvent,
	ModeChangedEvent,
	NoticeEvent,
	ActivityEvent,
	ErrorEvent,
	ExtensionEvent,
	SessionReplacedEvent,
	ResyncedEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

/** `seq` is assigned by the bridge core: 1, 2, 3… per session and stream epoch, without gaps. */
export const EventEnvelope = z.strictObject({
	session: SessionRef,
	seq: z.int().positive(),
	at: Timestamp,
	event: AgentEvent,
	native: NativeIds.optional(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
