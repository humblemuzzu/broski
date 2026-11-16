import { z } from "zod";
import { BackgroundTask } from "./activity";
import { CompactionTrigger } from "./compaction";
import { BlockKind, FileChange } from "./content";
import { BlockId, MessageId, ModelId, RunId, SessionRef, Timestamp, ToolCallId } from "./ids";
import { Interaction } from "./interactions";
import { JsonValue } from "./json";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { ModeSetting } from "./modes";
import { QueueItem } from "./queue";
import { RunOutcome, RunTrigger } from "./runs";
import { TranscriptItem } from "./transcript";
import { Usage } from "./usage";

/**
 * `items` is everything the run has finished so far, oldest first, with the live stream's ids. When a
 * run outgrows the bound the oldest items leave and `droppedItems` counts them; the transcript has
 * them once the run ends.
 */
export const ActiveRun = z.strictObject({
	runId: RunId,
	trigger: RunTrigger,
	startedAt: Timestamp,
	items: z.array(TranscriptItem).max(MAX_LIST_ITEMS),
	droppedItems: z.int().nonnegative(),
});
export type ActiveRun = z.infer<typeof ActiveRun>;

export const OpenBlock = z.strictObject({
	blockId: BlockId,
	messageId: MessageId,
	kind: BlockKind,
	parentToolCallId: ToolCallId.optional(),
	text: z.string().max(MAX_TEXT_CHARS),
});
export type OpenBlock = z.infer<typeof OpenBlock>;

/** `output` is the newest `MAX_TEXT_CHARS` of what the tool has printed. */
export const RunningTool = z.strictObject({
	toolCallId: ToolCallId,
	name: z.string().min(1).max(MAX_NAME_CHARS),
	title: z.string().max(MAX_NAME_CHARS).optional(),
	input: JsonValue.optional(),
	messageId: MessageId.optional(),
	parentToolCallId: ToolCallId.optional(),
	childSession: SessionRef.optional(),
	output: z.string().max(MAX_TEXT_CHARS),
	progress: z.string().max(MAX_TEXT_CHARS).optional(),
	fileChanges: z.array(FileChange).max(MAX_LIST_ITEMS),
});
export type RunningTool = z.infer<typeof RunningTool>;

export const CompactionState = z.strictObject({ trigger: CompactionTrigger, startedAt: Timestamp });
export type CompactionState = z.infer<typeof CompactionState>;

export const RetryState = z.strictObject({
	attempt: z.int().positive(),
	maxAttempts: z.int().positive().optional(),
	retryAt: Timestamp.optional(),
	message: z.string().max(MAX_TEXT_CHARS),
});
export type RetryState = z.infer<typeof RetryState>;

/**
 * The live state of a session: the active run with what it has finished so far, what is still in
 * flight, and the session's settings. Finished runs are read from the transcript. `lastOutcome` is
 * how the latest run ended.
 */
export const SessionSnapshot = z.strictObject({
	run: ActiveRun.optional(),
	blocks: z.array(OpenBlock).max(MAX_LIST_ITEMS),
	tools: z.array(RunningTool).max(MAX_LIST_ITEMS),
	interactions: z.array(Interaction).max(MAX_LIST_ITEMS),
	queue: z.array(QueueItem).max(MAX_LIST_ITEMS),
	backgroundTasks: z.array(BackgroundTask).max(MAX_LIST_ITEMS),
	modelId: ModelId.optional(),
	thinking: z.string().max(MAX_NAME_CHARS).optional(),
	modes: z.array(ModeSetting).max(MAX_LIST_ITEMS),
	usage: Usage.optional(),
	compaction: CompactionState.optional(),
	retry: RetryState.optional(),
	lastOutcome: RunOutcome.optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;
