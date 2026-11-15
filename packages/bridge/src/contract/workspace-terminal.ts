import { z } from "zod";
import { Timestamp } from "./ids";
import {
	MAX_ID_CHARS,
	MAX_NAME_CHARS,
	MAX_TERMINAL_DIMENSION,
	MAX_TERMINAL_OUTPUT_CHARS,
	MAX_TERMINALS,
} from "./limits";
import { Rejected } from "./rejection";
import { WorkingDirectory } from "./sessions";

export const TerminalId = z.string().min(1).max(MAX_ID_CHARS);
export type TerminalId = z.infer<typeof TerminalId>;

export const TerminalDimension = z.int().min(1).max(MAX_TERMINAL_DIMENSION);
export type TerminalDimension = z.infer<typeof TerminalDimension>;

/**
 * Byte offset into a terminal's output since it opened: `term_output.seq` is the offset of its first byte,
 * so the next one starts at `seq` plus its length.
 */
export const TerminalSeq = z.int().nonnegative();
export type TerminalSeq = z.infer<typeof TerminalSeq>;

/** Raw terminal output, base64: the bridge does not emulate a terminal, the phone does. */
export const TerminalOutput = z.base64().max(MAX_TERMINAL_OUTPUT_CHARS);
export type TerminalOutput = z.infer<typeof TerminalOutput>;

export const TerminalStatus = z.enum(["running", "exited"]);
export type TerminalStatus = z.infer<typeof TerminalStatus>;

/** `exitCode` or `signal` (such as `SIGKILL`) once exited, when the bridge saw how. */
export const TerminalSummary = z.strictObject({
	id: TerminalId,
	cwd: WorkingDirectory,
	cols: TerminalDimension,
	rows: TerminalDimension,
	createdAt: Timestamp,
	status: TerminalStatus,
	exitCode: z.int().nonnegative().optional(),
	signal: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type TerminalSummary = z.infer<typeof TerminalSummary>;

/** Newest first. */
export const TerminalsListed = z.strictObject({
	status: z.literal("accepted"),
	terminals: z.array(TerminalSummary).max(MAX_TERMINALS),
});
export type TerminalsListed = z.infer<typeof TerminalsListed>;

export const TermListResult = z.discriminatedUnion("status", [TerminalsListed, Rejected]);
export type TermListResult = z.infer<typeof TermListResult>;

export const TerminalOpened = z.strictObject({ status: z.literal("accepted"), terminal: TerminalSummary });
export type TerminalOpened = z.infer<typeof TerminalOpened>;

export const TermOpenResult = z.discriminatedUnion("status", [TerminalOpened, Rejected]);
export type TermOpenResult = z.infer<typeof TermOpenResult>;

/**
 * The output the terminal still holds from `seq` on: from the attach's `since` when it holds that much, else
 * from the oldest byte it holds, which a client that asked for more takes as a gap. Live `term_output` follows
 * from `seq` plus the replay's length, unless the terminal has exited.
 */
export const TerminalAttached = z.strictObject({
	status: z.literal("accepted"),
	terminal: TerminalSummary,
	seq: TerminalSeq,
	data: TerminalOutput,
});
export type TerminalAttached = z.infer<typeof TerminalAttached>;

export const TermAttachResult = z.discriminatedUnion("status", [TerminalAttached, Rejected]);
export type TermAttachResult = z.infer<typeof TermAttachResult>;

/** Output, only to the clients attached to the terminal. */
export const TermOutputMessage = z.strictObject({
	type: z.literal("term_output"),
	id: TerminalId,
	seq: TerminalSeq,
	data: TerminalOutput,
});
export type TermOutputMessage = z.infer<typeof TermOutputMessage>;

/** The terminal's process ended; nothing follows. Only to the clients attached to the terminal. */
export const TermExitedMessage = z.strictObject({
	type: z.literal("term_exited"),
	id: TerminalId,
	exitCode: z.int().nonnegative().optional(),
	signal: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type TermExitedMessage = z.infer<typeof TermExitedMessage>;

/** What the bridge's terminals tell the core, which sends it on as is. */
export const TerminalEvent = z.discriminatedUnion("type", [TermOutputMessage, TermExitedMessage]);
export type TerminalEvent = z.infer<typeof TerminalEvent>;
