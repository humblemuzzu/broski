import type {
	ActionResult,
	ClientMessage,
	ClientRequestId,
	FsImageResult,
	FsListResult,
	FsReadResult,
	FsSearchResult,
	GitBranchesResult,
	GitCheckoutResult,
	GitCommitResult,
	GitDiffResult,
	GitLogResult,
	GitStatusResult,
	PlanUsageResult,
	PromptAccepted,
	SessionRef,
	StreamEpoch,
	TermAttachResult,
	TerminalEvent,
	TermListResult,
	TermOpenResult,
	WorkspaceInfoResult,
} from "../contract";
import type { SecurePath } from "./secure-path";

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

/** The canonical form of a directory a request names, or why the bridge refuses to serve it. */
export type DirectoryPolicy = (path: string) => Promise<SecurePath>;

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

/** A workspace request's fields, as the client sent them. */
export type WorkspaceQuery<T extends ClientMessage["type"]> = Omit<
	Extract<ClientMessage, { type: T }>,
	"type" | "requestId"
>;

/**
 * The machine's files, git and terminals, which the bridge serves itself, not an agent backend. Every method
 * answers a value (`Rejected` for what it could not do) and checks every path against the bridge's path policy.
 * A `limit` or `budget` argument is the size the answer may take, which the core lowers from the request's own
 * when an answer does not fit the link.
 */
export interface WorkspaceHost {
	info(): Promise<WorkspaceInfoResult>;
	readonly files: {
		list(query: WorkspaceQuery<"fs.list">, limit: number): Promise<FsListResult>;
		read(query: WorkspaceQuery<"fs.read">, length: number): Promise<FsReadResult>;
		image(query: WorkspaceQuery<"fs.image">): Promise<FsImageResult>;
		search(query: WorkspaceQuery<"fs.search">, limit: number): Promise<FsSearchResult>;
	};
	readonly git: {
		status(query: WorkspaceQuery<"git.status">, limit: number): Promise<GitStatusResult>;
		/** `budget`: characters of line text. */
		diff(query: WorkspaceQuery<"git.diff">, budget: number): Promise<GitDiffResult>;
		stage(query: WorkspaceQuery<"git.stage">): Promise<ActionResult>;
		unstage(query: WorkspaceQuery<"git.unstage">): Promise<ActionResult>;
		commit(query: WorkspaceQuery<"git.commit">): Promise<GitCommitResult>;
		branches(query: WorkspaceQuery<"git.branches">, limit: number): Promise<GitBranchesResult>;
		checkout(query: WorkspaceQuery<"git.checkout">): Promise<GitCheckoutResult>;
		log(query: WorkspaceQuery<"git.log">, limit: number): Promise<GitLogResult>;
	};
	readonly terminals: {
		list(): Promise<TermListResult>;
		open(query: WorkspaceQuery<"term.open">): Promise<TermOpenResult>;
		/** Synchronous, like `input` and `resize`: nothing the terminal prints falls between the replay and the core's next output. */
		attach(query: WorkspaceQuery<"term.attach">): TermAttachResult;
		input(query: WorkspaceQuery<"term.input">): ActionResult;
		resize(query: WorkspaceQuery<"term.resize">): ActionResult;
		close(query: WorkspaceQuery<"term.close">): Promise<ActionResult>;
	};
	/** Bridge shutdown: every terminal ends. */
	dispose(): Promise<void>;
}

/**
 * The subscription plans signed in on the machine and how much of each is used, which the bridge reads itself from
 * the agents' sign-ins, not through a backend. `read` never throws: a plan it could not read carries its `problem`.
 */
export interface UsageReader {
	read(): Promise<PlanUsageResult>;
}

/** Where the workspace's terminals send their output and exits; it never throws. */
export type TerminalSink = (event: TerminalEvent) => void;

export type WorkspaceFactory = (sink: TerminalSink) => WorkspaceHost;

/** Durable memory of replaced streams, like the prompt journal: both methods handle their own I/O failures. */
export interface ReplacementJournal {
	/** The records kept by earlier runs of the bridge, oldest first. */
	load(): ReplacementRecord[];
	append(record: ReplacementRecord): void;
}
