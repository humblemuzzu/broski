/**
 * A backend's configuration for one project (protocol 1.4): the files it reads, one file at a time, and the settings
 * those files add up to. Each op names the project by `cwd`, which reaches the adapter canonical through the bridge's
 * directory policy, as a model list's does; none names a session, since configuration is files, not live state.
 */

import { z } from "zod";
import { ActionList } from "./action-list";
import { EditableFile, EditableFileChange, EditableFileFormat } from "./editable-file";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS } from "./limits";
import { WorkingDirectory } from "./sessions";

/** The op kinds that read and change a project's configuration (since 1.4, `ADDED_IN_MINOR.configOps`). */
export const CONFIG_OP_KINDS = ["config_files", "config_file", "settings_overview"] as const;

/**
 * One configuration file the backend reads for the project. `group` (what the file configures) and `scope` (whose
 * file it is: the user's, the project's, a machine policy's) are the backend's own short words, for listing files
 * together. `exists` false: the file is not there yet and a write creates it. `template`: not a file but the place a
 * new named file goes (a command, an agent); `config_file` reads and writes it with a `name`, and `path` is the
 * directory the file goes in.
 */
export const ConfigFileEntry = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	label: z.string().min(1).max(MAX_NAME_CHARS),
	group: z.string().min(1).max(MAX_NAME_CHARS),
	scope: z.string().min(1).max(MAX_NAME_CHARS),
	path: z.string().min(1).max(MAX_PATH_CHARS),
	exists: z.boolean(),
	editable: z.boolean(),
	format: EditableFileFormat,
	template: z.boolean(),
});
export type ConfigFileEntry = z.infer<typeof ConfigFileEntry>;

/** The configuration files the backend reads for the project at `cwd`. */
export const ConfigFilesOp = z.strictObject({
	kind: z.literal("config_files"),
	cwd: WorkingDirectory,
});
export type ConfigFilesOp = z.infer<typeof ConfigFilesOp>;

/** `omitted` counts the files left out because the list is at its bound. */
export const ConfigFilesListed = z.strictObject({
	kind: z.literal("config_files"),
	files: z.array(ConfigFileEntry).max(MAX_LIST_ITEMS),
	omitted: z.int().nonnegative(),
});
export type ConfigFilesListed = z.infer<typeof ConfigFilesListed>;

/**
 * One file `config_files` listed, read, or changed first and then read. `name` names the new file a `template` entry
 * makes (and only such an entry takes one). Refusals: a file id the listing does not have is `not_found`; a `name`
 * missing, given where none is taken, or not a file name is `invalid_input`; a change against another revision is
 * `stale`; a JSON write that does not parse is `invalid_input`; a file the backend may not change is `unsupported`.
 */
export const ConfigFileOp = z.strictObject({
	kind: z.literal("config_file"),
	cwd: WorkingDirectory,
	fileId: z.string().min(1).max(MAX_ID_CHARS),
	name: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	change: EditableFileChange.optional(),
});
export type ConfigFileOp = z.infer<typeof ConfigFileOp>;

/** The file as it is now, after the change when there was one. */
export const ConfigFileRead = z.strictObject({
	kind: z.literal("config_file"),
	file: EditableFile,
});
export type ConfigFileRead = z.infer<typeof ConfigFileRead>;

/**
 * The settings in effect for the project and where each comes from, read-only: one row per setting with its value as
 * the subtitle and its source as a badge, the problems that make the backend skip a file, and the account.
 */
export const SettingsOverviewOp = z.strictObject({
	kind: z.literal("settings_overview"),
	cwd: WorkingDirectory,
});
export type SettingsOverviewOp = z.infer<typeof SettingsOverviewOp>;

export const SettingsOverviewRead = z.strictObject({
	kind: z.literal("settings_overview"),
	list: ActionList,
});
export type SettingsOverviewRead = z.infer<typeof SettingsOverviewRead>;
