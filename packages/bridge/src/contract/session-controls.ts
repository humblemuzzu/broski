/**
 * What a phone reads and changes on a session beside the conversation (protocol 1.3): the session's own
 * settings, its tools and its system prompt. Each is one `backend.call` op that reads when it carries no
 * change and changes then answers with what the session now has. The results are plain data (a list of
 * switches and choices, a list of tools, a page of text), so a screen renders them by shape.
 *
 * The `kind` literals are those of `BackendOpKind` in `backend-ops.ts`, which imports this file.
 */

import { z } from "zod";
import { SessionId } from "./ids";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { Option } from "./option";

export const SettingKey = z.string().min(1).max(MAX_ID_CHARS);
export type SettingKey = z.infer<typeof SettingKey>;

/** An on/off setting. `note` says why the value shown may not be the one a person just chose. */
export const ToggleSetting = z.strictObject({
	kind: z.literal("toggle"),
	key: SettingKey,
	label: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	enabled: z.boolean(),
	note: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type ToggleSetting = z.infer<typeof ToggleSetting>;

/** A setting with a short list of values; `value` is one of `options`. */
export const ChoiceSetting = z.strictObject({
	kind: z.literal("choice"),
	key: SettingKey,
	label: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	value: z.string().max(MAX_NAME_CHARS),
	options: z.array(Option).min(1).max(MAX_LIST_ITEMS),
	note: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type ChoiceSetting = z.infer<typeof ChoiceSetting>;

export const SessionSetting = z.discriminatedUnion("kind", [ToggleSetting, ChoiceSetting]);
export type SessionSetting = z.infer<typeof SessionSetting>;

export const ToggleChange = z.strictObject({
	kind: z.literal("toggle"),
	key: SettingKey,
	enabled: z.boolean(),
});
export type ToggleChange = z.infer<typeof ToggleChange>;

export const ChoiceChange = z.strictObject({
	kind: z.literal("choice"),
	key: SettingKey,
	value: z.string().max(MAX_NAME_CHARS),
});
export type ChoiceChange = z.infer<typeof ChoiceChange>;

export const SettingChange = z.discriminatedUnion("kind", [ToggleChange, ChoiceChange]);
export type SettingChange = z.infer<typeof SettingChange>;

/** Pi: the settings the session runs under. With `change` that one is set first. */
export const SessionSettingsOp = z.strictObject({
	kind: z.literal("session_settings"),
	sessionId: SessionId,
	change: SettingChange.optional(),
});
export type SessionSettingsOp = z.infer<typeof SessionSettingsOp>;

/** The settings as the session has them now, after the change when there was one. */
export const SessionSettingsResult = z.strictObject({
	kind: z.literal("session_settings"),
	settings: z.array(SessionSetting).max(MAX_LIST_ITEMS),
});
export type SessionSettingsResult = z.infer<typeof SessionSettingsResult>;

/** One tool the session knows. `group` names where it comes from, to list tools together. */
export const SessionTool = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS),
	active: z.boolean(),
	group: z.string().max(MAX_NAME_CHARS).optional(),
});
export type SessionTool = z.infer<typeof SessionTool>;

export const ToolChange = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	active: z.boolean(),
});
export type ToolChange = z.infer<typeof ToolChange>;

/** Pi: the tools the session can use and which are on. With `change` that tool is switched first. */
export const SessionToolsOp = z.strictObject({
	kind: z.literal("session_tools"),
	sessionId: SessionId,
	change: ToolChange.optional(),
});
export type SessionToolsOp = z.infer<typeof SessionToolsOp>;

/** `omitted` counts the tools left out because the list is at its bound; absent when none is. */
export const SessionToolsResult = z.strictObject({
	kind: z.literal("session_tools"),
	tools: z.array(SessionTool).max(MAX_LIST_ITEMS),
	omitted: z.int().positive().optional(),
});
export type SessionToolsResult = z.infer<typeof SessionToolsResult>;

/** Pi: the session's system prompt, a page of it starting at UTF-16 offset `offset` (0 when absent). */
export const SystemPromptOp = z.strictObject({
	kind: z.literal("system_prompt"),
	sessionId: SessionId,
	offset: z.int().nonnegative().optional(),
});
export type SystemPromptOp = z.infer<typeof SystemPromptOp>;

/**
 * `text` starts at `offset`; `nextOffset` is where the following page starts and is absent on the last one;
 * `totalChars` is the whole prompt's length at the time (it can change between pages when a tool is switched).
 */
export const SystemPromptResult = z.strictObject({
	kind: z.literal("system_prompt"),
	text: z.string().max(MAX_TEXT_CHARS),
	offset: z.int().nonnegative(),
	totalChars: z.int().nonnegative(),
	nextOffset: z.int().positive().optional(),
});
export type SystemPromptResult = z.infer<typeof SystemPromptResult>;
