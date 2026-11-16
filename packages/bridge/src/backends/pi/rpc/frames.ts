/**
 * The records `pi --mode rpc` writes on stdout, checked before anything reads them: command responses, session
 * events and extension UI requests (pi-coding-agent 1.5.2 `docs/rpc.md:22-33`, `docs/json.md`,
 * `docs/rpc-extension-ui.md`, `dist/modes/rpc/rpc-types.d.ts`, `dist/core/agent-session.d.ts:49-111`). Each schema
 * holds the fields the adapter reads and nothing else; an event or UI method it has no use for is `ignored`.
 */

import { z } from "zod";
import type { StreamEvent } from "../mapping/stream-event";
import type { PiMessage } from "../messages";

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });
const ImageBlock = z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() });
const ThinkingBlock = z.object({ type: z.literal("thinking"), thinking: z.string() });
export const ToolCallBlock = z.object({
	type: z.literal("toolCall"),
	id: z.string(),
	name: z.string(),
	arguments: z.record(z.string(), z.unknown()),
});

const UNSUPPORTED = { type: "unsupported" } as const;

/** A block of another type stays in its place as `unsupported` (`messages.ts`). */
function blocks<T extends z.ZodType>(known: T) {
	return z.array(z.unknown()).transform((items) =>
		items.map((item) => {
			const parsed = known.safeParse(item);
			return parsed.success ? parsed.data : UNSUPPORTED;
		}),
	);
}

const UserContent = z.union([z.string(), blocks(z.union([TextBlock, ImageBlock]))]);
const ResultContent = blocks(z.union([TextBlock, ImageBlock]));

const STOP_REASONS = ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"] as const;

const MESSAGES = [
	z.object({ role: z.literal("user"), content: UserContent, timestamp: z.number() }),
	z.object({
		role: z.literal("assistant"),
		content: blocks(z.union([TextBlock, ThinkingBlock, ToolCallBlock])),
		stopReason: z.enum(STOP_REASONS),
		errorMessage: z.string().optional(),
		timestamp: z.number(),
	}),
	z.object({
		role: z.literal("toolResult"),
		toolCallId: z.string(),
		toolName: z.string(),
		content: ResultContent,
		details: z.unknown().optional(),
		isError: z.boolean(),
		timestamp: z.number(),
	}),
	z.object({
		role: z.literal("custom"),
		customType: z.string(),
		content: UserContent,
		display: z.boolean(),
		details: z.unknown().optional(),
		timestamp: z.number(),
	}),
	z.object({ role: z.literal("other") }),
] as const;

const READ_ROLES: ReadonlySet<unknown> = new Set(MESSAGES.map((schema) => schema.shape.role.value));

/** A message of a role the adapter reads must hold what it reads; any other role is `other` (the system prompt, a bash run, a summary). */
const Message = z.preprocess(
	(value) => (tagOf(value, "role") !== undefined && READ_ROLES.has(tagOf(value, "role")) ? value : { role: "other" }),
	z.discriminatedUnion("role", MESSAGES),
) satisfies z.ZodType<PiMessage, unknown>;

const ToolPayload = z.object({ content: ResultContent.optional(), details: z.unknown().optional() });

const STREAM_EVENTS = [
	z.object({ type: z.literal("text_start"), contentIndex: z.number() }),
	z.object({ type: z.literal("thinking_start"), contentIndex: z.number() }),
	z.object({ type: z.literal("text_delta"), contentIndex: z.number(), delta: z.string() }),
	z.object({ type: z.literal("thinking_delta"), contentIndex: z.number(), delta: z.string() }),
	z.object({ type: z.literal("text_end"), contentIndex: z.number(), content: z.string() }),
	z.object({ type: z.literal("thinking_end"), contentIndex: z.number(), content: z.string() }),
	z.object({ type: z.literal("toolcall_start"), contentIndex: z.number(), id: z.string(), toolName: z.string() }),
	z.object({ type: z.literal("toolcall_end"), contentIndex: z.number(), toolCall: ToolCallBlock }),
	z.object({ type: z.literal("ignored") }),
] as const;

const STREAMED_TYPES: ReadonlySet<unknown> = new Set(STREAM_EVENTS.map((schema) => schema.shape.type.value));

/** `start`, `toolcall_delta`, `done` and `error` carry nothing the stream mapping uses (`docs/json.md:76-91`): `ignored`. */
const StreamUpdate = z.preprocess(
	(value) => (STREAMED_TYPES.has(tagOf(value, "type")) ? value : { type: "ignored" }),
	z.discriminatedUnion("type", STREAM_EVENTS),
) satisfies z.ZodType<StreamEvent | { type: "ignored" }, unknown>;

const COMPACTION_REASONS = ["manual", "threshold", "overflow"] as const;
const optionalString = z.string().optional();

const EVENTS = {
	agent_start: z.object({ type: z.literal("agent_start") }),
	agent_settled: z.object({ type: z.literal("agent_settled"), aborted: z.boolean() }),
	message_start: z.object({ type: z.literal("message_start"), message: Message }),
	message_update: z.object({ type: z.literal("message_update"), assistantMessageEvent: StreamUpdate }),
	message_end: z.object({ type: z.literal("message_end"), message: Message }),
	tool_execution_start: z.object({
		type: z.literal("tool_execution_start"),
		toolCallId: z.string(),
		toolName: z.string(),
		args: z.unknown(),
		parentToolCallId: optionalString,
	}),
	tool_execution_update: z.object({
		type: z.literal("tool_execution_update"),
		toolCallId: z.string(),
		toolName: z.string(),
		args: z.unknown(),
		partialResult: ToolPayload,
		parentToolCallId: optionalString,
	}),
	tool_execution_end: z.object({
		type: z.literal("tool_execution_end"),
		toolCallId: z.string(),
		toolName: z.string(),
		result: ToolPayload,
		isError: z.boolean(),
		parentToolCallId: optionalString,
	}),
	queue_update: z.object({
		type: z.literal("queue_update"),
		steering: z.array(z.string()),
		followUp: z.array(z.string()),
	}),
	compaction_start: z.object({ type: z.literal("compaction_start"), reason: z.enum(COMPACTION_REASONS) }),
	compaction_end: z.object({
		type: z.literal("compaction_end"),
		reason: z.enum(COMPACTION_REASONS),
		result: z.object({ tokensBefore: z.number().optional(), estimatedTokensAfter: z.number().optional() }).optional(),
		aborted: z.boolean(),
		errorMessage: optionalString,
	}),
	auto_retry_start: z.object({
		type: z.literal("auto_retry_start"),
		attempt: z.number(),
		maxAttempts: z.number(),
		delayMs: z.number(),
		errorMessage: z.string(),
	}),
	auto_retry_end: z.object({ type: z.literal("auto_retry_end"), success: z.boolean() }),
	thinking_level_changed: z.object({ type: z.literal("thinking_level_changed"), level: z.string() }),
	session_info_changed: z.object({ type: z.literal("session_info_changed"), name: optionalString }),
	entry_appended: z.object({
		type: z.literal("entry_appended"),
		entry: z.object({ id: z.string(), parentId: z.string().nullable(), type: z.string() }),
	}),
	extension_error: z.object({
		type: z.literal("extension_error"),
		extensionPath: z.string(),
		event: z.string(),
		error: z.string(),
	}),
};

export type PiEvent = z.output<(typeof EVENTS)[keyof typeof EVENTS]>;
export type PiEventOf<T extends PiEvent["type"]> = Extract<PiEvent, { type: T }>;

const timeout = z.number().optional();

const UI_REQUESTS = {
	select: z.object({
		method: z.literal("select"),
		id: z.string(),
		title: z.string(),
		options: z.array(z.string()),
		timeout,
	}),
	confirm: z.object({ method: z.literal("confirm"), id: z.string(), title: z.string(), message: z.string(), timeout }),
	input: z.object({
		method: z.literal("input"),
		id: z.string(),
		title: z.string(),
		placeholder: optionalString,
		timeout,
	}),
	editor: z.object({ method: z.literal("editor"), id: z.string(), title: z.string(), prefill: optionalString }),
	notify: z.object({
		method: z.literal("notify"),
		id: z.string(),
		message: z.string(),
		notifyType: z.enum(["info", "warning", "error"]).optional(),
	}),
	setStatus: z.object({
		method: z.literal("setStatus"),
		id: z.string(),
		statusKey: z.string(),
		/** Absent: the status is cleared. */
		statusText: z.string().optional(),
	}),
};

export type UiRequest = z.output<(typeof UI_REQUESTS)[keyof typeof UI_REQUESTS]>;
export type DialogRequest = Exclude<UiRequest, { method: "notify" | "setStatus" }>;

const Response = z.object({
	type: z.literal("response"),
	id: optionalString,
	command: z.string(),
	success: z.boolean(),
	data: z.unknown().optional(),
	error: optionalString,
});

export type ResponseFrame = z.output<typeof Response>;

export type InboundFrame =
	| { readonly kind: "response"; readonly response: ResponseFrame }
	| { readonly kind: "event"; readonly event: PiEvent }
	| { readonly kind: "ui"; readonly request: UiRequest }
	| { readonly kind: "ignored" }
	| { readonly kind: "invalid"; readonly reason: string };

function tagOf(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined;
}

/** One stdout record. An event whose known fields break their schema is `invalid`, never half read. */
export function parseFrame(text: string): InboundFrame {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { kind: "invalid", reason: "a record that is not JSON" };
	}
	const type = tagOf(value, "type");
	if (typeof type !== "string") return { kind: "invalid", reason: "a record with no type" };
	if (type === "response") return checked(type, Response, value, (response) => ({ kind: "response", response }));
	if (type === "extension_ui_request") {
		const method = tagOf(value, "method");
		if (typeof method !== "string" || !Object.hasOwn(UI_REQUESTS, method)) return { kind: "ignored" };
		const schema: z.ZodType<UiRequest> = UI_REQUESTS[method as keyof typeof UI_REQUESTS];
		return checked(method, schema, value, (request) => ({ kind: "ui", request }));
	}
	if (!Object.hasOwn(EVENTS, type)) return { kind: "ignored" };
	const schema: z.ZodType<PiEvent> = EVENTS[type as keyof typeof EVENTS];
	return checked(type, schema, value, (event) => ({ kind: "event", event }));
}

function checked<T>(
	name: string,
	schema: z.ZodType<T>,
	value: unknown,
	frame: (data: T) => InboundFrame,
): InboundFrame {
	const parsed = schema.safeParse(value);
	if (parsed.success) return frame(parsed.data);
	const issue = parsed.error.issues[0];
	return { kind: "invalid", reason: `${name} ${issue?.path.join(".") ?? ""}: ${issue?.message ?? "malformed"}` };
}
