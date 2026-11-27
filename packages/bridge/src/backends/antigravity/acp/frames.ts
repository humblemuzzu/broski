/**
 * The ACP v1 payloads the adapter reads (agentclientprotocol.com `schema/v1/schema.json`), only the fields it uses.
 * Extra keys are dropped, a list item of another shape is skipped as the schema's own readers skip it, and an optional
 * field may be `null`, which the schema treats as absent.
 */

import { z } from "zod";

export const ACP_PROTOCOL_VERSION = 1;

function listOf<T extends z.ZodType>(item: T) {
	return z.array(z.unknown()).transform((entries) =>
		entries.flatMap((entry): z.output<T>[] => {
			const parsed = item.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		}),
	);
}

const Meta = z.record(z.string(), z.unknown()).nullish();

export const InitializeResult = z.object({
	protocolVersion: z.number(),
	agentCapabilities: z
		.object({
			loadSession: z.boolean().nullish(),
			sessionCapabilities: z.object({ list: z.unknown(), close: z.unknown() }).nullish(),
		})
		.nullish(),
});
export type InitializeResult = z.infer<typeof InitializeResult>;

const ConfigValue = z.object({ value: z.string(), name: z.string(), description: z.string().nullish() });
const ConfigGroup = z.object({ group: z.string(), name: z.string(), options: listOf(ConfigValue) });

export const ConfigOption = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullish(),
	category: z.string().nullish(),
	type: z.string(),
	currentValue: z.union([z.string(), z.boolean()]),
	options: listOf(z.union([ConfigValue, ConfigGroup])).nullish(),
});
export type ConfigOption = z.infer<typeof ConfigOption>;

export const NewSessionResult = z.object({
	sessionId: z.string(),
	configOptions: listOf(ConfigOption).nullish(),
	_meta: Meta,
});
export type NewSessionResult = z.infer<typeof NewSessionResult>;

export const SetConfigOptionResult = z.object({ configOptions: listOf(ConfigOption) });

const SessionInfo = z.object({
	sessionId: z.string(),
	cwd: z.string().nullish(),
	title: z.string().nullish(),
	updatedAt: z.string().nullish(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const ListSessionsResult = z.object({ sessions: listOf(SessionInfo), nextCursor: z.string().nullish() });

/** `usage` is no field of v1's `PromptResponse`; agy 1.5.18 sends it with the turn's token counts. */
export const PromptResult = z.object({
	stopReason: z.string(),
	usage: z
		.object({
			inputTokens: z.number().nullish(),
			outputTokens: z.number().nullish(),
			cachedReadTokens: z.number().nullish(),
			thoughtTokens: z.number().nullish(),
		})
		.nullish(),
});
export type PromptResult = z.infer<typeof PromptResult>;

/** A result the adapter reads nothing from: `session/load`'s and `session/close`'s. */
export const AnyResult = z.unknown();

const ContentBlock = z.object({ type: z.string(), text: z.string().nullish() });

const ToolContent = z.union([
	z.object({ type: z.literal("content"), content: ContentBlock }),
	z.object({ type: z.literal("diff"), path: z.string(), oldText: z.string().nullish(), newText: z.string() }),
]);
export type ToolContent = z.infer<typeof ToolContent>;

const ToolLocation = z.object({ path: z.string() });

const ToolFields = {
	toolCallId: z.string(),
	title: z.string().nullish(),
	name: z.string().nullish(),
	kind: z.string().nullish(),
	status: z.string().nullish(),
	content: listOf(ToolContent).nullish(),
	locations: listOf(ToolLocation).nullish(),
	rawInput: z.unknown(),
	rawOutput: z.unknown(),
};
const ToolCallFields = z.object(ToolFields);
export type ToolCallFields = z.infer<typeof ToolCallFields>;

const Chunk = { content: ContentBlock };

const AvailableCommand = z.object({
	name: z.string(),
	description: z.string().nullish(),
	input: z.object({ hint: z.string().nullish() }).nullish(),
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
		title: z.string().nullish(),
		updatedAt: z.string().nullish(),
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
	toolCallId: z.string().nullish(),
	mode: z.string(),
	message: z.string(),
	requestedSchema: z
		.object({ properties: z.record(z.string(), z.unknown()).nullish(), required: z.array(z.string()).nullish() })
		.nullish(),
});
export type ElicitationRequest = z.infer<typeof ElicitationRequest>;

/** A capability the agent offers: the schema's capabilities are objects, absent or `null` when not offered. */
export function isOffered(capability: unknown): boolean {
	return capability !== undefined && capability !== null && capability !== false;
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
		...(value.description != null && { description: value.description }),
		...(group !== undefined && { group }),
	};
}
