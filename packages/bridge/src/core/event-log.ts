import type { EncodedFrame } from "./frame";

export interface ReplayWindow {
	/** Events the log keeps at most. */
	readonly maxEvents: number;
	/** Bytes of encoded frames the log keeps at most; the newest event stays even when it alone is larger. */
	readonly maxBytes: number;
}

/** For a phone that drops off for a moment; past this window one snapshot is cheaper than the events it replaces. */
export const DEFAULT_REPLAY_WINDOW: ReplayWindow = { maxEvents: 4_096, maxBytes: 4 * 1024 * 1024 };

interface LoggedEvent {
	readonly seq: number;
	readonly frame: EncodedFrame;
}

/** The newest events of one session stream, as the frames viewers were sent, for replay on reattach. */
export class EventLog {
	private entries: LoggedEvent[] = [];
	private head = 0;
	private bytes = 0;

	constructor(private readonly window: ReplayWindow) {}

	/** `seq` is one above the previous event's. */
	push(seq: number, frame: EncodedFrame): void {
		this.entries.push({ seq, frame });
		this.bytes += frame.bytes;
		while (this.size() > this.window.maxEvents || (this.bytes > this.window.maxBytes && this.size() > 1)) {
			this.dropOldest();
		}
	}

	/**
	 * The frames of every event after `seq` when the log still holds all of them, up to `lastSeq`,
	 * the stream's newest; undefined when it no longer reaches back that far or `seq` is not of this stream.
	 */
	after(seq: number, lastSeq: number): EncodedFrame[] | undefined {
		if (seq > lastSeq) return undefined;
		if (seq === lastSeq) return [];
		const oldest = this.entries[this.head];
		if (!oldest || seq < oldest.seq - 1) return undefined;
		return this.entries.slice(this.head + (seq - oldest.seq + 1)).map((entry) => entry.frame);
	}

	private size(): number {
		return this.entries.length - this.head;
	}

	private dropOldest(): void {
		const oldest = this.entries[this.head];
		if (!oldest) return;
		this.bytes -= oldest.frame.bytes;
		this.head += 1;
		if (this.head * 2 >= this.entries.length) {
			this.entries = this.entries.slice(this.head);
			this.head = 0;
		}
	}
}
