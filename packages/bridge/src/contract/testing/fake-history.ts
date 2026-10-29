import type { AgentEvent } from "../events";
import type { TranscriptItemId } from "../ids";
import { completedCall, finishedItems, withoutRetracted } from "../run-items";
import type { SessionSnapshot } from "../snapshot";
import type { TranscriptItem } from "../transcript";

/** A transcript item and the order it was written in, which survives retractions. */
export interface TranscriptEntry {
	readonly seq: number;
	item: TranscriptItem;
}

/** The fake backend's stored history of one session, written as events happen. */
export class FakeHistory {
	readonly entries: TranscriptEntry[] = [];
	private nextSeq = 1;

	constructor(private readonly newId: () => string) {}

	items(): TranscriptItem[] {
		return this.entries.map((entry) => entry.item);
	}

	/** The write position the next item gets; entries before it were written earlier. */
	position(): number {
		return this.nextSeq;
	}

	append(items: readonly TranscriptItem[]): void {
		for (const item of items) this.entries.push({ seq: this.nextSeq++, item });
	}

	clear(): void {
		this.entries.splice(0, this.entries.length);
	}

	/** Keeps the history up to and including `itemId`; false when there is no such item. */
	truncateAfter(itemId: TranscriptItemId): boolean {
		const index = this.entries.findIndex((entry) => entry.item.id === itemId);
		if (index < 0) return false;
		this.entries.splice(index + 1);
		return true;
	}

	/** Writes what `event` adds to history; `before` is the live state just before it applies. */
	record(before: SessionSnapshot, at: number, event: AgentEvent): void {
		if (event.type === "messages_retracted") this.retract(event.messageIds);
		if (event.type === "tool_finished") this.completeCall(before, event.toolCallId);
		this.append([...finishedItems(before, { at, event }), ...this.backendItems(before, at, event)]);
	}

	/** What the fake backend keeps beyond the run's own items: markers, notices and settings changes. */
	private backendItems(before: SessionSnapshot, at: number, event: AgentEvent): TranscriptItem[] {
		switch (event.type) {
			case "compaction_finished": {
				const outcome = event.outcome;
				if (outcome.kind !== "completed") return [];
				const { kind: _kind, ...tokens } = outcome;
				const trigger = before.compaction?.trigger;
				return [{ kind: "compaction", id: this.newId(), at, ...(trigger && { trigger }), ...tokens }];
			}
			case "model_changed": {
				const { type: _type, ...change } = event;
				return [{ kind: "model_change", id: this.newId(), at, ...change }];
			}
			case "notice":
				return [{ kind: "notice", id: this.newId(), at, level: event.level, text: event.text }];
			case "run_finished":
				return [{ kind: "run_boundary", id: this.newId(), at, outcome: event.outcome }];
			default:
				return [];
		}
	}

	private completeCall(before: SessionSnapshot, toolCallId: string): void {
		const entry = this.entries.find((candidate) => candidate.item.id === toolCallId);
		if (entry?.item.kind !== "tool_call") throw new Error(`tool ${toolCallId} finished without starting`);
		entry.item = completedCall(entry.item, before);
	}

	private retract(messageIds: readonly string[]): void {
		const kept = new Set(withoutRetracted(this.items(), messageIds));
		const survivors = this.entries.filter((entry) => kept.has(entry.item));
		this.entries.splice(0, this.entries.length, ...survivors);
	}
}
