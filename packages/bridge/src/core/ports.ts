import type { ClientRequestId, PromptAccepted, SessionRef, StreamEpoch } from "../contract";

/** Where the frames for one client go. `send` never throws: a frame for a client that has gone is dropped. */
export interface ClientLink {
	send(frame: string): void;
}

export interface CoreLog {
	info(message: string): void;
	error(message: string): void;
}

/** Time as the core sees it: the wall clock, and one-shot timers whose returned function cancels them. */
export interface CoreClock {
	now(): number;
	after(ms: number, run: () => void): () => void;
}

/** The canonical form of a directory a request names, or undefined when the bridge refuses to serve it. */
export type DirectoryPolicy = (path: string) => Promise<string | undefined>;

/** One accepted prompt, as the prompt journal keeps it across bridge restarts. */
export interface JournalEntry {
	readonly session: SessionRef;
	readonly clientRequestId: ClientRequestId;
	readonly result: PromptAccepted;
}

/** Durable memory of accepted prompts. Both methods handle their own I/O failures. */
export interface PromptJournal {
	/** The entries kept by earlier runs of the bridge, oldest first. */
	load(): JournalEntry[];
	append(entry: JournalEntry): void;
}

/** One stream that ended in `session_replaced`: the conversation went on as `next`, in the stream `nextEpoch`. */
export interface ReplacementRecord {
	readonly epoch: StreamEpoch;
	readonly next: SessionRef;
	readonly nextEpoch: StreamEpoch;
	/** When the stream ended, in the core clock's milliseconds. */
	readonly at: number;
}

/** Durable memory of replaced streams, like the prompt journal: both methods handle their own I/O failures. */
export interface ReplacementJournal {
	/** The records kept by earlier runs of the bridge, oldest first. */
	load(): ReplacementRecord[];
	append(record: ReplacementRecord): void;
}
