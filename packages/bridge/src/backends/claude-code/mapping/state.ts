/** What the mapper remembers between frames. */

import type { BlockId, ToolCallId } from "../../../contract";
import type { MappingSeed } from "../ports/mapping";
import { MessageLedger } from "./message-ledger";

/** The stream key of the main session; a subagent's key is its agent id (never empty). */
export const MAIN = "";

const MAX_LEDGERS = 64;
const MAX_REMEMBERED = 4_096;

export interface OpenBlock {
	readonly messageId: string;
	readonly kind: "text" | "thinking";
	readonly streams: readonly string[];
	/** The text delivered so far, within the contract's bound. */
	text: string;
}

export interface FrameMessage {
	readonly messageId: string;
	readonly streams: readonly string[];
}

export interface OpenTool {
	readonly name: string;
	readonly messageId: string | undefined;
	readonly input: unknown;
	readonly streams: readonly string[];
	progress: string | undefined;
	childLinked: boolean;
}

/** A task the CLI started (`task_started`), for the background list and its end. */
export interface KnownTask {
	readonly taskType: string | undefined;
	readonly command: string | undefined;
	readonly startedAt: number;
	/** Registered or moved to the background, so no tool call's result reports its end. */
	background: boolean;
}

/** The compaction the CLI reported: `status: compacting` seen, and whether its `compact_boundary` is still to come. */
export type CompactionPhase = "none" | "running" | "awaiting_boundary";

/** An insertion-ordered set that forgets its oldest member past `max`. */
export class RecentSet {
	private readonly members = new Set<string>();

	constructor(private readonly max: number) {}

	add(member: string): void {
		this.members.delete(member);
		this.members.add(member);
		if (this.members.size > this.max) this.members.delete(this.members.values().next().value ?? member);
	}

	has(member: string): boolean {
		return this.members.has(member);
	}
}

export class MapperState {
	readonly ownSends = new RecentSet(MAX_REMEMBERED);
	readonly startedTools = new RecentSet(MAX_REMEMBERED);
	/** Messages already retracted, so a second frame naming another block of one says nothing more. */
	readonly retracted = new RecentSet(MAX_REMEMBERED);
	readonly openBlocks = new Map<BlockId, OpenBlock>();
	readonly openTools = new Map<ToolCallId, OpenTool>();
	/** Tools a `permission_denied` frame named, until their result arrives. */
	readonly denied = new Set<ToolCallId>();
	/** Assistant frame uuid → its `message.id` and the streams it was shown in, for the frames a retraction names. */
	readonly frameMessages = new Map<string, FrameMessage>();
	private readonly ledgers = new Map<string, MessageLedger>();
	/** The message the stream is delivering, from `message_start` to `message_stop`. */
	streaming: MessageLedger | undefined;
	retrying = false;
	compaction: CompactionPhase = "none";
	/** A `system/init` or a model request has been seen in the turn in progress. */
	turnUnderway = false;
	/** When the main loop's latest response began to stream: the cache window's `lastTouchAt` at the turn's result. */
	requestAt: number | undefined;
	model: string | undefined;
	/** The last rate limit sent per window, so a repeated one is not sent again. */
	readonly rateLimits = new Map<string, string>();
	readonly tasks = new Map<string, KnownTask>();
	faultReported = false;

	constructor(
		readonly seed: MappingSeed,
		readonly now: () => number,
	) {}

	ledger(messageId: string): MessageLedger {
		const known = this.ledgers.get(messageId);
		if (known) return known;
		const created = new MessageLedger(messageId);
		this.ledgers.set(messageId, created);
		if (this.ledgers.size > MAX_LEDGERS) this.ledgers.delete(this.ledgers.keys().next().value ?? messageId);
		return created;
	}

	rememberTask(taskId: string, task: KnownTask): void {
		this.tasks.delete(taskId);
		this.tasks.set(taskId, task);
		if (this.tasks.size > MAX_REMEMBERED) this.tasks.delete(this.tasks.keys().next().value ?? taskId);
	}

	rememberFrame(uuid: string, messageId: string, streams: readonly string[]): void {
		this.frameMessages.delete(uuid);
		this.frameMessages.set(uuid, { messageId, streams });
		if (this.frameMessages.size > MAX_REMEMBERED) {
			this.frameMessages.delete(this.frameMessages.keys().next().value ?? uuid);
		}
	}
}
