/**
 * The `custom` entries this bridge keeps in a Pi session file, and how they read back. Pi keeps `custom` entries out of
 * the model's context (pi-coding-agent 1.5.2 `docs/session-format.md:164-172`). A hosted session's file is written by
 * its `pi` alone, so these reach it through the bridge's own extension in that `pi` (`host/extension/`), which appends
 * them wherever the session's leaf is then: a record names the entry it is about, never its neighbour.
 */

import {
	type ClientRequestId,
	ClientRequestId as ClientRequestIdSchema,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
} from "../../contract";
import { isPermissionsMode, type PermissionsMode } from "./modes";

/** Written when this bridge creates a session, so a list row says `origin: "broski"` after a restart. */
export const ORIGIN_ENTRY = "broski.origin";

/** The prompt a user message came from, so the transcript names its `clientRequestId` and its images' names. */
export const PROMPT_ENTRY = "broski.prompt";

/**
 * Written when the `permissions` mode changes or a tool is allowed for the session, so a session opened again is still
 * guarded and still lets through what the human allowed for it.
 */
export const PERMISSIONS_ENTRY = "broski.permissions";

/**
 * The outcome of a tool result the live stream finished `denied` or `aborted`: Pi stores either as an ordinary error,
 * so without it the transcript would say `failed` where the run said otherwise.
 */
export const TOOL_OUTCOME_ENTRY = "broski.tool_outcome";

/** The outcomes of a failed tool result that only this bridge knows. */
export type RecordedToolOutcome = "denied" | "aborted";

export interface PromptRecord {
	readonly clientRequestId: ClientRequestId;
	/** By image block, in the order the user message holds them; Pi stores no image names. */
	readonly imageNames: readonly (string | null)[];
}

export interface PermissionsRecord {
	readonly mode: PermissionsMode;
	/** The tools a human allowed "for this session". */
	readonly allowedTools: readonly string[];
}

/** What the records of a file say about one of its entries. */
export interface EntryRecords {
	readonly prompt?: PromptRecord;
	readonly toolOutcome?: RecordedToolOutcome;
}

/** A record as the extension appends it: its type and its data. */
export interface BroskiRecord {
	readonly customType: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export function promptRecord(entryId: string, record: PromptRecord): BroskiRecord {
	return {
		customType: PROMPT_ENTRY,
		data: { entryId, clientRequestId: record.clientRequestId, imageNames: [...record.imageNames] },
	};
}

export function toolOutcomeRecord(entryId: string, outcome: RecordedToolOutcome): BroskiRecord {
	return { customType: TOOL_OUTCOME_ENTRY, data: { entryId, outcome } };
}

export function permissionsRecord(record: PermissionsRecord): BroskiRecord {
	return { customType: PERMISSIONS_ENTRY, data: { mode: record.mode, allowedTools: [...record.allowedTools] } };
}

type CustomLine = { readonly type: string; readonly customType?: unknown; readonly data?: unknown };

/** What a `broski.permissions` entry holds, or undefined for any other entry or a malformed one. */
export function readPermissionsRecord(entry: CustomLine): PermissionsRecord | undefined {
	if (entry.type !== "custom" || entry.customType !== PERMISSIONS_ENTRY || !isObject(entry.data)) return undefined;
	const { mode, allowedTools = [] } = entry.data;
	if (typeof mode !== "string" || !isPermissionsMode(mode)) return undefined;
	if (!Array.isArray(allowedTools) || allowedTools.length > MAX_LIST_ITEMS || !allowedTools.every(isToolName)) {
		return undefined;
	}
	return { mode, allowedTools };
}

export function isOriginEntry(entry: CustomLine): boolean {
	return entry.type === "custom" && entry.customType === ORIGIN_ENTRY;
}

/** The entry a `broski.prompt` or `broski.tool_outcome` line is about, with what it says; undefined for any other line. */
export function readEntryRecord(entry: CustomLine): { entryId: string; records: EntryRecords } | undefined {
	if (entry.type !== "custom" || !isObject(entry.data) || typeof entry.data.entryId !== "string") return undefined;
	const { entryId } = entry.data;
	if (entry.customType === PROMPT_ENTRY) {
		const prompt = promptOf(entry.data);
		return prompt === undefined ? undefined : { entryId, records: { prompt } };
	}
	if (entry.customType !== TOOL_OUTCOME_ENTRY) return undefined;
	const { outcome } = entry.data;
	return outcome === "denied" || outcome === "aborted" ? { entryId, records: { toolOutcome: outcome } } : undefined;
}

function promptOf(data: Readonly<Record<string, unknown>>): PromptRecord | undefined {
	const id = ClientRequestIdSchema.safeParse(data.clientRequestId);
	const names = data.imageNames;
	if (!id.success || !Array.isArray(names) || names.length > MAX_LIST_ITEMS || !names.every(isImageName)) {
		return undefined;
	}
	return { clientRequestId: id.data, imageNames: names };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolName(name: unknown): name is string {
	return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_CHARS;
}

function isImageName(name: unknown): name is string | null {
	return name === null || (typeof name === "string" && name.length <= MAX_NAME_CHARS);
}
