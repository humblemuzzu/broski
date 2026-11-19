/**
 * What a terminal `pi` and the bridge say to each other over the link socket, one JSON object per line. The terminal's
 * side is the extension (`extension/`), which sends only what Pi's extension events carry
 * (pi-coding-agent 1.5.2 `docs/extensions.md:305-1160`): the run, its text, thinking and tools, compactions, the model and
 * the thinking level, the session's name, and the background tasks other extensions announce on Pi's event bus
 * (`broski:tasks`). Pi hands extensions no event for its queue or its automatic retries, so the link carries neither.
 * The dialogs the terminal shows (Pi's select, confirm and input, and the questions on `broski:questions`) are
 * mirrored, and the phone's answer goes back as a command. Every frame is checked here, strictly and within bounds,
 * before anything reads it.
 */

import { z } from "zod";
import type { JsonValue } from "../../../contract";
import { AskedQuestions, QuestionAnswers } from "../ui/questions-dialog";

/**
 * Fields are only ever added, and optional, so a `pi` that loaded an older copy of the extension before the bridge
 * rewrote it still links; the version changes only for what an older side would misread.
 */
export const LINK_VERSION = 1;

/** The largest line either side reads: a prompt with its images fits. */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

const Text = z.string().max(1_048_576);
const Name = z.string().min(1).max(1_024);
const Id = z.string().min(1).max(256);
const Count = z.int().nonnegative();

/** JSON of any shape, which the extension has already cut down (strings, depth, arrays); the bridge bounds it again when it maps it. */
const Json: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);
const JsonObjectShape: z.ZodType<{ [key: string]: JsonValue }> = z.record(z.string(), Json);

export const TextBlock = z.strictObject({ type: z.literal("text"), text: Text });
export const ImageBlock = z.strictObject({ type: z.literal("image"), mimeType: Name, data: z.string().max(0) });
export const ThinkingBlock = z.strictObject({ type: z.literal("thinking"), thinking: Text });
export const CallBlock = z.strictObject({
	type: z.literal("toolCall"),
	id: Id,
	name: z.string().max(1_024),
	arguments: JsonObjectShape,
});

const ToolContent = z.array(z.discriminatedUnion("type", [TextBlock, ImageBlock])).max(1_000);
export const ToolResultShape = z.strictObject({ content: ToolContent.optional(), details: Json.optional() });

export const StreamEvent = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("text_start"), contentIndex: Count }),
	z.strictObject({ type: z.literal("text_delta"), contentIndex: Count, delta: Text }),
	z.strictObject({ type: z.literal("text_end"), contentIndex: Count, content: Text }),
	z.strictObject({ type: z.literal("thinking_start"), contentIndex: Count }),
	z.strictObject({ type: z.literal("thinking_delta"), contentIndex: Count, delta: Text }),
	z.strictObject({ type: z.literal("thinking_end"), contentIndex: Count, content: Text }),
	z.strictObject({ type: z.literal("toolcall_start"), contentIndex: Count, id: Id, toolName: z.string().max(1_024) }),
	z.strictObject({ type: z.literal("toolcall_end"), contentIndex: Count, toolCall: CallBlock }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const StopReason = z.enum(["stop", "length", "toolUse", "error", "aborted", "deferred", "pending"]);

/** The messages Pi ends, cut to what the bridge reads. */
export const EndedMessage = z.discriminatedUnion("role", [
	z.strictObject({ role: z.literal("user"), text: Text }),
	z.strictObject({
		role: z.literal("assistant"),
		content: z.array(z.discriminatedUnion("type", [TextBlock, ThinkingBlock, CallBlock])).max(1_000),
		stopReason: StopReason,
		errorMessage: Text.optional(),
		provider: Name,
	}),
	z.strictObject({
		role: z.literal("custom"),
		customType: z.string().max(1_024).optional(),
		display: z.boolean(),
		text: Text,
		details: Json.optional(),
	}),
	z.strictObject({ role: z.literal("other") }),
]);
export type EndedMessage = z.infer<typeof EndedMessage>;

const Parent = { parentToolCallId: Id.optional() };

const Timeout = { timeout: z.number().positive().optional() };

/** A dialog in the terminal, as Pi's own call described it. */
export const Dialog = z.discriminatedUnion("method", [
	z.strictObject({ method: z.literal("select"), title: Text, options: z.array(Text).max(1_000), ...Timeout }),
	z.strictObject({ method: z.literal("confirm"), title: Text, message: Text, ...Timeout }),
	z.strictObject({ method: z.literal("input"), title: Text, placeholder: Text.optional(), ...Timeout }),
	z.strictObject({ method: z.literal("questions"), title: Text.optional(), questions: AskedQuestions }),
]);
export type Dialog = z.infer<typeof Dialog>;

/** The phone's answer to a dialog: Pi's own answer shapes, and the answers to questions. */
export const DialogReply = z.union([
	z.strictObject({ value: Text }),
	z.strictObject({ confirmed: z.boolean() }),
	z.strictObject({ cancelled: z.literal(true) }),
	z.strictObject({ answers: QuestionAnswers }),
]);
export type DialogReply = z.infer<typeof DialogReply>;

export const TerminalEvent = z.discriminatedUnion("e", [
	z.strictObject({ e: z.literal("agent_start"), leafId: Id.nullable() }),
	z.strictObject({ e: z.literal("agent_settled"), aborted: z.boolean() }),
	z.strictObject({ e: z.literal("message_start"), role: z.enum(["user", "assistant", "toolResult", "other"]) }),
	z.strictObject({ e: z.literal("stream"), ev: StreamEvent }),
	z.strictObject({ e: z.literal("message_end"), message: EndedMessage }),
	z.strictObject({
		e: z.literal("tool_start"),
		toolCallId: Id,
		toolName: z.string().max(1_024),
		args: Json,
		...Parent,
	}),
	z.strictObject({
		e: z.literal("tool_update"),
		toolCallId: Id,
		toolName: z.string().max(1_024),
		args: Json,
		partialResult: ToolResultShape,
		...Parent,
	}),
	z.strictObject({
		e: z.literal("tool_end"),
		toolCallId: Id,
		toolName: z.string().max(1_024),
		result: ToolResultShape,
		isError: z.boolean(),
		...Parent,
	}),
	z.strictObject({ e: z.literal("model"), provider: Name, id: Name }),
	z.strictObject({ e: z.literal("thinking"), level: Name }),
	z.strictObject({ e: z.literal("name") }),
	z.strictObject({ e: z.literal("compaction_start"), reason: z.enum(["manual", "threshold", "overflow"]) }),
	z.strictObject({
		e: z.literal("compaction_end"),
		reason: z.enum(["manual", "threshold", "overflow"]),
		outcome: z.enum(["completed", "aborted", "failed"]),
		tokensBefore: Count.optional(),
		error: Text.optional(),
	}),
	z.strictObject({
		e: z.literal("ui_prompt"),
		phase: z.enum(["start", "end"]),
		title: Name.optional(),
	}),
	/** The list as the extension that announced it gave it; the bridge reads it as `mapping/background-tasks.ts` says. */
	z.strictObject({ e: z.literal("tasks"), tasks: Json }),
	z.strictObject({ e: z.literal("dialog_open"), id: Id, dialog: Dialog }),
	/** Answered in the terminal, or ended by the extension that asked. */
	z.strictObject({ e: z.literal("dialog_close"), id: Id }),
]);
export type TerminalEvent = z.infer<typeof TerminalEvent>;

/** What the terminal's session is doing now: enough to join a run already under way. */
export const TerminalState = z.strictObject({
	running: z.boolean(),
	runStartedAt: z.int().nonnegative().optional(),
	leafId: Id.nullable(),
	model: z.strictObject({ provider: Name, id: Name, images: z.boolean() }).optional(),
	thinking: Name.optional(),
	blocks: z.array(z.strictObject({ index: Count, kind: z.enum(["text", "thinking"]), text: Text })).max(1_000),
	tools: z.array(z.strictObject({ id: Id, name: z.string().max(1_024), args: Json })).max(1_000),
	tasks: Json.optional(),
	dialogs: z
		.array(z.strictObject({ id: Id, dialog: Dialog }))
		.max(100)
		.optional(),
});
export type TerminalState = z.infer<typeof TerminalState>;

const Session = z.strictObject({ file: z.string().min(1).max(4_096), id: Id, cwd: z.string().max(4_096) });
const ShutdownReason = z.enum(["quit", "reload", "new", "resume", "fork"]);
const FailureCode = z.enum(["busy", "no_model", "invalid_input", "backend_error"]);

export const CommandAnswer = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), disposition: z.enum(["started", "steered", "queued", "stopped", "answered"]) }),
	z.strictObject({ ok: z.literal(false), code: FailureCode, message: Text }),
]);
export type CommandAnswer = z.infer<typeof CommandAnswer>;

export const ExtensionFrame = z.discriminatedUnion("t", [
	z.strictObject({
		t: z.literal("hello"),
		v: z.int(),
		key: z.string().max(128),
		pid: z.int().positive(),
		extension: z.string().max(64),
		session: Session,
	}),
	z.strictObject({ t: z.literal("snapshot"), reason: z.enum(["connect", "resync"]), state: TerminalState }),
	z.strictObject({ t: z.literal("event"), event: TerminalEvent }),
	z.strictObject({ t: z.literal("result"), id: Id, answer: CommandAnswer }),
	z.strictObject({ t: z.literal("bye"), reason: ShutdownReason }),
]);
export type ExtensionFrame = z.infer<typeof ExtensionFrame>;

export const Command = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("prompt"),
		mode: z.enum(["start", "steer", "queue"]),
		text: Text,
		/** Dispatches a `/command` and expands a template or skill, which a plain message must not. */
		expand: z.boolean(),
		images: z.array(z.strictObject({ mimeType: Name, data: z.string().max(6_000_000) })).max(100),
	}),
	z.strictObject({ kind: z.literal("abort") }),
	z.strictObject({ kind: z.literal("answer"), id: Id, reply: DialogReply }),
]);
export type Command = z.infer<typeof Command>;

export const BridgeFrame = z.discriminatedUnion("t", [
	z.strictObject({ t: z.literal("welcome"), running: z.boolean() }),
	/** The bridge's own `pi` started or stopped running the session the terminal has open; an older extension ignores it. */
	z.strictObject({ t: z.literal("hosted"), running: z.boolean() }),
	z.strictObject({ t: z.literal("command"), id: Id, command: Command }),
]);
export type BridgeFrame = z.infer<typeof BridgeFrame>;
