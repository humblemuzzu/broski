/**
 * What a terminal `pi` and the bridge say to each other over the link socket, one JSON object per line. The terminal's
 * side is the extension (`extension/`), which sends only what Pi's extension events carry
 * (pi-coding-agent 1.5.2 `docs/extensions.md:305-1160`): the run, its text, thinking and tools, compactions, the model and
 * the thinking level, the session's name. Pi hands extensions no event for its queue or its automatic retries, so the
 * link carries neither. Every frame is checked here, strictly and within bounds, before anything reads it.
 */

import { z } from "zod";
import type { JsonValue } from "../../../contract";

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
	z.strictObject({ role: z.literal("custom"), display: z.boolean(), text: Text }),
	z.strictObject({ role: z.literal("other") }),
]);
export type EndedMessage = z.infer<typeof EndedMessage>;

const Parent = { parentToolCallId: Id.optional() };

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
]);
export type TerminalEvent = z.infer<typeof TerminalEvent>;

/** What the terminal's session is doing now: enough to join a run already under way. */
export const TerminalState = z.strictObject({
	running: z.boolean(),
	leafId: Id.nullable(),
	model: z.strictObject({ provider: Name, id: Name, images: z.boolean() }).optional(),
	thinking: Name.optional(),
	blocks: z.array(z.strictObject({ index: Count, kind: z.enum(["text", "thinking"]), text: Text })).max(1_000),
	tools: z.array(z.strictObject({ id: Id, name: z.string().max(1_024), args: Json })).max(1_000),
});
export type TerminalState = z.infer<typeof TerminalState>;

const Session = z.strictObject({ file: z.string().min(1).max(4_096), id: Id, cwd: z.string().max(4_096) });
const ShutdownReason = z.enum(["quit", "reload", "new", "resume", "fork"]);
const FailureCode = z.enum(["busy", "no_model", "invalid_input", "backend_error"]);

export const CommandAnswer = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), disposition: z.enum(["started", "steered", "queued", "stopped"]) }),
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
]);
export type Command = z.infer<typeof Command>;

export const BridgeFrame = z.discriminatedUnion("t", [
	z.strictObject({ t: z.literal("welcome"), running: z.boolean() }),
	z.strictObject({ t: z.literal("command"), id: Id, command: Command }),
]);
export type BridgeFrame = z.infer<typeof BridgeFrame>;
