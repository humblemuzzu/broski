/**
 * The ACP v1 payloads the adapter reads (agentclientprotocol.com `schema/v1/schema.json`), only the fields it uses, read
 * as the schema's own readers read them: extra keys are dropped, a field the schema marks optional is absent when it is
 * missing, `null` or of another shape, and a list item of another shape is skipped. Only a required field that does not
 * read fails the payload.
 */

import { z } from "zod";

export const ACP_PROTOCOL_VERSION = 1;

/** ACP's `auth_required` error, which agy answers when it holds no sign-in. */
export const AUTH_REQUIRED = -32000;

function optional<T extends z.ZodType>(field: T) {
	return field
		.nullish()
		.transform((value) => value ?? undefined)
		.catch(undefined)
		.optional();
}

function listOf<T extends z.ZodType>(item: T) {
	return z.array(z.unknown()).transform((entries) =>
		entries.flatMap((entry): z.output<T>[] => {
			const parsed = item.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		}),
	);
}

const Meta = optional(z.record(z.string(), z.unknown()));

/** A capability is an object, its options inside it; any other value offers nothing. */
const Capability = optional(z.object({}));

export const InitializeResult = z.object({
	protocolVersion: z.number(),
	agentCapabilities: optional(
		z.object({
			loadSession: optional(z.boolean()),
			sessionCapabilities: optional(z.object({ list: Capability, close: Capability })),
		}),
	),
});
export type InitializeResult = z.infer<typeof InitializeResult>;

const ConfigValue = z.object({ value: z.string(), name: z.string(), description: optional(z.string()) });
const ConfigGroup = z.object({ group: z.string(), name: z.string(), options: listOf(ConfigValue) });

export const ConfigOption = z.object({
	id: z.string(),
	name: z.string(),
	description: optional(z.string()),
	category: optional(z.string()),
	type: z.string(),
	currentValue: z.union([z.string(), z.boolean()]),
	options: optional(listOf(z.union([ConfigValue, ConfigGroup]))),
});
export type ConfigOption = z.infer<typeof ConfigOption>;

export const NewSessionResult = z.object({
	sessionId: z.string(),
	configOptions: optional(listOf(ConfigOption)),
	_meta: Meta,
});
export type NewSessionResult = z.infer<typeof NewSessionResult>;

export const SetConfigOptionResult = z.object({ configOptions: listOf(ConfigOption) });
export type SetConfigOptionResult = z.infer<typeof SetConfigOptionResult>;

export const LoadSessionResult = z.object({ configOptions: optional(listOf(ConfigOption)) });

/** The schema requires `cwd`; a row without one is read as a session whose folder agy did not keep. */
const SessionInfo = z.object({
	sessionId: z.string(),
	cwd: optional(z.string()),
	title: optional(z.string()),
	updatedAt: optional(z.string()),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const ListSessionsResult = z.object({ sessions: listOf(SessionInfo), nextCursor: optional(z.string()) });

const TokenCount = optional(z.int().nonnegative());

/**
 * `usage` is no field of v1's `PromptResponse` but of the unstable schema's (`schema.unstable.json` `Usage`, "token
 * usage for this turn"); agy 1.5.18 sends it with the turn's token counts.
 */
export const PromptResult = z.object({
	stopReason: z.string(),
	usage: optional(
		z.object({
			totalTokens: TokenCount,
			inputTokens: TokenCount,
			outputTokens: TokenCount,
			cachedReadTokens: TokenCount,
			thoughtTokens: TokenCount,
		}),
	),
});
export type PromptResult = z.infer<typeof PromptResult>;
export type TurnUsage = NonNullable<PromptResult["usage"]>;

/** `$/cancel_request`'s params: the id of a request its sender takes back (`CancelRequestNotification`). */
export const CancelRequest = z.object({ requestId: z.union([z.string(), z.number(), z.null()]) });

/** A result the adapter reads nothing from: `session/load`'s and `session/close`'s. */
export const AnyResult = z.unknown();

const ContentBlock = z.object({ type: z.string(), text: optional(z.string()) });

const ToolContent = z.union([
	z.object({ type: z.literal("content"), content: ContentBlock }),
	z.object({ type: z.literal("diff"), path: z.string(), oldText: optional(z.string()), newText: z.string() }),
]);
export type ToolContent = z.infer<typeof ToolContent>;

const ToolLocation = z.object({ path: z.string() });

/** A `tool_call`'s and a `tool_call_update`'s: the schema requires a `title` of the first only. */
const ToolFields = {
	toolCallId: z.string(),
	title: optional(z.string()),
	name: optional(z.string()),
	kind: optional(z.string()),
	status: optional(z.string()),
	content: optional(listOf(ToolContent)),
	locations: optional(listOf(ToolLocation)),
	rawInput: optional(z.unknown()),
	rawOutput: optional(z.unknown()),
};
const ToolCallFields = z.object(ToolFields);
export type ToolCallFields = z.infer<typeof ToolCallFields>;

const Chunk = { content: ContentBlock };

const AvailableCommand = z.object({
	name: z.string(),
	description: optional(z.string()),
	input: optional(z.object({ hint: optional(z.string()) })),
});
export type AvailableCommand = z.infer<typeof AvailableCommand>;

export const SessionUpdate = z.discriminatedUnion("sessionUpdate", [
	z.object({ sessionUpdate: z.literal("agent_message_chunk"), ...Chunk }),
	z.object({ sessionUpdate: z.literal("agent_thought_chunk"), ...Chunk }),
	z.object({ sessionUpdate: z.literal("user_message_chunk"), ...Chunk }),
	z.object({ sessionUpdate: z.literal("tool_call"), ...ToolFields }),
	z.object({ sessionUpdate: z.literal("tool_call_update"), ...ToolFields }),
	z.object({ sessionUpdate: z.literal("usage_update"), used: z.number(), size: z.number() }),
	z.object({
		sessionUpdate: z.literal("session_info_update"),
		title: optional(z.string()),
		updatedAt: optional(z.string()),
	}),
	z.object({ sessionUpdate: z.literal("available_commands_update"), availableCommands: listOf(AvailableCommand) }),
	z.object({ sessionUpdate: z.literal("config_option_update"), configOptions: listOf(ConfigOption) }),
	z.object({ sessionUpdate: z.literal("current_mode_update"), currentModeId: z.string() }),
]);
export type SessionUpdate = z.infer<typeof SessionUpdate>;

const KNOWN_UPDATES = new Set<string>(SessionUpdate.options.map((option) => option.shape.sessionUpdate.value));

export const SessionNotification = z.object({
	sessionId: z.string(),
	update: z.object({ sessionUpdate: z.string() }).loose(),
});

/** Whether a kind the adapter could not read is one it reads, so failing to read it is a fault. */
export function isKnownUpdate(kind: string): boolean {
	return KNOWN_UPDATES.has(kind);
}

export const PermissionRequest = z.object({
	sessionId: z.string(),
	toolCall: ToolCallFields,
	options: listOf(z.object({ optionId: z.string(), name: z.string(), kind: z.string() })),
	_meta: Meta,
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

/** A form's `requestedSchema` is kept as JSON: which property shapes a question takes is the reader's to decide. */
export const ElicitationRequest = z.object({
	sessionId: z.string(),
	toolCallId: optional(z.string()),
	mode: z.string(),
	message: z.string(),
	requestedSchema: optional(
		z.object({
			properties: optional(z.record(z.string(), z.unknown())),
			required: optional(z.array(z.string())),
		}),
	),
});
export type ElicitationRequest = z.infer<typeof ElicitationRequest>;

export function isOffered(capability: object | undefined): capability is object {
	return capability !== undefined;
}

/** A select option's values, a grouped list flattened in order with each value's group name. */
export function selectValues(
	option: ConfigOption,
): Array<{ value: string; name: string; description?: string; group?: string }> {
	return (option.options ?? []).flatMap((entry) =>
		"group" in entry ? entry.options.map((value) => selectValue(value, entry.name)) : [selectValue(entry, undefined)],
	);
}

function selectValue(value: z.infer<typeof ConfigValue>, group: string | undefined) {
	return {
		value: value.value,
		name: value.name,
		...(value.description !== undefined && { description: value.description }),
		...(group !== undefined && { group }),
	};
}
