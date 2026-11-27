/**
 * The history of a session the bridge hosts, oldest first: what agy replayed as the host loaded it (nothing for a
 * session agy made for it), then what the host's own events finish, written with the contract's run items
 * (`contract/run-items.ts`, which build the `run.items` the phone shows live), so a finished run reads back as the
 * phone saw it, ids included. A compaction agy completed is a compaction item, and what it wrote is the activity after
 * it. While a run is on, the history ends before the run's first item, which is its snapshot's (contract README §8).
 */

import {
	completedCall,
	finishedItems,
	type SessionSnapshot,
	type SinkRecord,
	type TranscriptItem,
} from "../../../contract";

export class HostHistory {
	private readonly items: TranscriptItem[];
	/** Where the items of the run under way start. */
	private runStart: number | undefined;

	constructor(replayed: readonly TranscriptItem[]) {
		this.items = [...replayed];
	}

	/** Writes what `record` finishes, before anyone sees the event; `before` is the live state it applies to. */
	record(before: SessionSnapshot, record: Pick<SinkRecord, "at" | "event">): void {
		const { at, event } = record;
		switch (event.type) {
			case "run_started":
				this.runStart = this.items.length;
				return;
			case "run_finished":
				this.runStart = undefined;
				return;
			case "tool_finished":
				this.completeCall(before, event.toolCallId);
				break;
			case "compaction_finished": {
				if (event.outcome.kind !== "completed") return;
				const { kind: _kind, ...tokens } = event.outcome;
				const trigger = before.compaction?.trigger;
				this.items.push({ kind: "compaction", id: crypto.randomUUID(), at, ...(trigger && { trigger }), ...tokens });
				return;
			}
		}
		this.items.push(...finishedItems(before, record));
	}

	/** Every item but those of the run under way. */
	finished(): readonly TranscriptItem[] {
		return this.runStart === undefined ? [...this.items] : this.items.slice(0, this.runStart);
	}

	private completeCall(before: SessionSnapshot, toolCallId: string): void {
		const index = this.items.findLastIndex((item) => item.kind === "tool_call" && item.toolCallId === toolCallId);
		const call = this.items[index];
		if (call?.kind === "tool_call") this.items[index] = completedCall(call, before);
	}
}
