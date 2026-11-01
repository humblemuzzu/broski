/** What the tail's translator remembers between lines: the open run and tools, and the ids already used. */

import type { RunId, ToolCallId } from "../../../contract";
import { mintRunId } from "../ids";
import type { MappedEvent } from "../ports/mapping";

const MAX_REMEMBERED = 50_000;
const MAX_MESSAGE_COUNTERS = 256;

/** The stop reasons after which a message needs no more blocks and no tool result. */
const FINAL_STOPS: ReadonlySet<string> = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"]);

/** A set that forgets its oldest member past a bound. */
export class RecentSet {
	private readonly members = new Set<string>();

	constructor(private readonly max: number) {}

	has(value: string): boolean {
		return this.members.has(value);
	}

	add(value: string): void {
		this.members.add(value);
		if (this.members.size > this.max) {
			const oldest = this.members.values().next();
			if (!oldest.done) this.members.delete(oldest.value);
		}
	}
}

export interface OpenTool {
	readonly name: string;
	readonly input: unknown;
}

export class TranslatorState {
	runId: RunId | undefined;
	lastStop: string | undefined;
	readonly tools = new Map<ToolCallId, OpenTool>();
	readonly seenUuids = new RecentSet(MAX_REMEMBERED);
	readonly seenBlocks = new RecentSet(MAX_REMEMBERED);
	readonly seenTools = new RecentSet(MAX_REMEMBERED);
	private readonly nextIndex = new Map<string, number>();

	/** No tool is waiting for a result and the last message said it was the last. */
	get settled(): boolean {
		return (
			this.runId !== undefined && this.tools.size === 0 && this.lastStop !== undefined && FINAL_STOPS.has(this.lastStop)
		);
	}

	startRun(out: MappedEvent[]): RunId {
		if (this.runId !== undefined) return this.runId;
		this.runId = mintRunId();
		out.push({
			event: { type: "run_started", runId: this.runId, trigger: "external" },
		});
		return this.runId;
	}

	finishRun(out: MappedEvent[], kind: "completed" | "aborted"): void {
		const runId = this.runId;
		if (runId === undefined) return;
		for (const toolCallId of this.tools.keys()) {
			out.push({
				event: {
					type: "tool_finished",
					toolCallId,
					outcome: "aborted",
					result: { content: [], fileChanges: [] },
				},
			});
		}
		this.tools.clear();
		out.push({ event: { type: "run_finished", runId, outcome: { kind } } });
		this.runId = undefined;
		this.lastStop = undefined;
	}

	/** The position of a message's next block when its lines carry no `apiBlockIndex`. */
	fallbackIndex(messageId: string): number {
		const next = this.nextIndex.get(messageId) ?? 0;
		this.nextIndex.set(messageId, next + 1);
		if (this.nextIndex.size > MAX_MESSAGE_COUNTERS) {
			const oldest = this.nextIndex.keys().next();
			if (!oldest.done) this.nextIndex.delete(oldest.value);
		}
		return next;
	}

	noteIndex(messageId: string, index: number): void {
		this.nextIndex.set(messageId, Math.max(this.nextIndex.get(messageId) ?? 0, index + 1));
	}
}
