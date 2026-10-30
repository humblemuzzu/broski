/**
 * The `custom` entries the adapter appends to a Pi session file, and how they read back. Pi keeps
 * `custom` entries out of the model's context (`sessionEntryToContextMessages`, pi-coding-agent
 * `src/core/session-manager.ts:439-466`).
 */

import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	type ClientRequestId,
	ClientRequestId as ClientRequestIdSchema,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
} from "../../contract";
import { isPermissionsMode, type PermissionsMode } from "./modes";

/** Appended when this bridge creates a session, so a list row says `origin: "broski"` after a restart. */
export const ORIGIN_ENTRY = "broski.origin";

/** Appended right after a prompt's user message (D5), so the transcript names the prompt's id. */
export const PROMPT_ENTRY = "broski.prompt";

/**
 * Appended when the `permissions` mode changes or a tool is allowed for the session, so a session reopened later is
 * still guarded (D14) and still lets through what the human allowed for it.
 */
export const PERMISSIONS_ENTRY = "broski.permissions";

/**
 * Appended right after a tool result the live stream finished `denied` or `aborted`: Pi stores either as an
 * ordinary error result, so without it the transcript would say `failed` where the run said otherwise.
 */
export const TOOL_OUTCOME_ENTRY = "broski.tool_outcome";

/** The outcomes of a failed tool result that only this bridge knows. */
export type RecordedToolOutcome = "denied" | "aborted";

export interface PromptRecord {
	readonly clientRequestId: ClientRequestId;
	/** By image block, in the order the user message holds them; Pi stores no image names. */
	readonly imageNames: readonly (string | null)[];
}

export function promptEntryData(record: PromptRecord): { clientRequestId: string; imageNames: (string | null)[] } {
	return { clientRequestId: record.clientRequestId, imageNames: [...record.imageNames] };
}

export interface PermissionsRecord {
	readonly mode: PermissionsMode;
	/** The tools a human allowed "for this session"; an entry written before there were any holds none. */
	readonly allowedTools: readonly string[];
}

export function permissionsEntryData(
	mode: PermissionsMode,
	allowedTools: readonly string[],
): { mode: PermissionsMode; allowedTools: string[] } {
	return { mode, allowedTools: [...allowedTools] };
}

/** What a `broski.permissions` entry holds, or undefined for any other entry or a malformed one. */
export function readPermissionsRecord(entry: SessionEntry): PermissionsRecord | undefined {
	if (entry.type !== "custom" || entry.customType !== PERMISSIONS_ENTRY) return undefined;
	const data = entry.data;
	if (typeof data !== "object" || data === null || !("mode" in data) || typeof data.mode !== "string") return undefined;
	if (!isPermissionsMode(data.mode)) return undefined;
	const allowed = "allowedTools" in data ? data.allowedTools : [];
	if (!Array.isArray(allowed) || allowed.length > MAX_LIST_ITEMS || !allowed.every(isToolName)) return undefined;
	return { mode: data.mode, allowedTools: allowed };
}

function isToolName(name: unknown): name is string {
	return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME_CHARS;
}

export function toolOutcomeEntryData(outcome: RecordedToolOutcome): { outcome: RecordedToolOutcome } {
	return { outcome };
}

/** The outcome a `broski.tool_outcome` entry holds, or undefined for any other entry or a malformed one. */
export function readToolOutcomeRecord(entry: SessionEntry): RecordedToolOutcome | undefined {
	if (entry.type !== "custom" || entry.customType !== TOOL_OUTCOME_ENTRY) return undefined;
	const data = entry.data;
	if (typeof data !== "object" || data === null || !("outcome" in data)) return undefined;
	return data.outcome === "denied" || data.outcome === "aborted" ? data.outcome : undefined;
}

export function isOriginEntry(entry: SessionEntry): boolean {
	return entry.type === "custom" && entry.customType === ORIGIN_ENTRY;
}

/** The record a `broski.prompt` entry holds, or undefined for any other entry or a malformed one. */
export function readPromptRecord(entry: SessionEntry): PromptRecord | undefined {
	if (entry.type !== "custom" || entry.customType !== PROMPT_ENTRY) return undefined;
	return promptRecordOf(entry);
}

function promptRecordOf(entry: CustomEntry): PromptRecord | undefined {
	const data = entry.data;
	if (typeof data !== "object" || data === null || !("clientRequestId" in data) || !("imageNames" in data)) {
		return undefined;
	}
	const id = ClientRequestIdSchema.safeParse(data.clientRequestId);
	const names = data.imageNames;
	if (!id.success || !Array.isArray(names) || names.length > MAX_LIST_ITEMS || !names.every(isImageName)) {
		return undefined;
	}
	return { clientRequestId: id.data, imageNames: names };
}

function isImageName(name: unknown): name is string | null {
	return name === null || (typeof name === "string" && name.length <= MAX_NAME_CHARS);
}
