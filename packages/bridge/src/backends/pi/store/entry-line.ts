/**
 * What a session file line is, found as cheaply as the line allows. Pi writes `{type, id, parentId,
 * timestamp, message}` in that order for every entry but `custom` and `custom_message`
 * (pi-coding-agent `src/core/session-manager.ts`, the `append*` methods), so the type, the ids and a
 * message's role are read from the first bytes with no `JSON.parse`; any other line is parsed.
 */

import type { FileHandle } from "node:fs/promises";
import { readText, type ScannedLine } from "./line-scanner";

/** Printable ASCII but `"` and `\`: an id outside it is not one Pi minted. */
const ID = "[\\x20\\x21\\x23-\\x5b\\x5d-\\x7e]{1,128}";
const PREFIX = new RegExp(
	`^\\{"type":"([a-z_]{1,32})","id":"(${ID})","parentId":(?:null|"(${ID})"),"timestamp":"[^"\\\\]{0,64}"(?:,"message":\\{"role":"([A-Za-z]{1,32})")?`,
);

interface LinePrefix {
	readonly type: string;
	readonly id: string;
	readonly parentId: string | null;
	readonly role: string | undefined;
}

export function readPrefix(head: string): LinePrefix | undefined {
	const match = PREFIX.exec(head);
	if (!match) return undefined;
	const [, type = "", id = "", parentId, role] = match;
	return { type, id, parentId: parentId ?? null, role };
}

export type JsonRecord = { readonly [key: string]: unknown };

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord | undefined {
	return isRecord(value) ? value : undefined;
}

export function stringOf(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** A line as the scans need it; `record` is set when the line had to be parsed to be classified. */
export interface LineKind {
	readonly type: string;
	readonly id: string | undefined;
	readonly parentId: string | null | undefined;
	readonly role: string | undefined;
	readonly record: JsonRecord | undefined;
}

/** Undefined for a blank line, one that is not a JSON object, one with no string `type`, or one too long to read. */
export async function lineKind(handle: FileHandle, line: ScannedLine): Promise<LineKind | undefined> {
	const prefix = line.terminated ? readPrefix(line.head) : undefined;
	if (prefix) return { ...prefix, record: undefined };
	if (line.length === 0) return undefined;
	const text = await readText(handle, line.offset, line.length);
	return text === undefined ? undefined : kindOfRecord(asRecord(parseJson(text)));
}

function kindOfRecord(record: JsonRecord | undefined): LineKind | undefined {
	const type = stringOf(record?.type);
	if (record === undefined || type === undefined) return undefined;
	const parentId = record.parentId;
	return {
		type,
		id: stringOf(record.id),
		parentId: parentId === null || typeof parentId === "string" ? parentId : undefined,
		role: type === "message" ? stringOf(asRecord(record.message)?.role) : undefined,
		record,
	};
}
