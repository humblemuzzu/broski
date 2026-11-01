/**
 * A strict read-modify-write of a user's JSON object file: a file that does not parse, or is too large, is refused and
 * left byte for byte as it was; every other key survives; the write is atomic and does not overwrite a change made
 * meanwhile. A symlinked file (a dotfiles manager's) is edited where it points, so the link stays a link.
 */

import { realpath } from "node:fs/promises";
import { readFileForEdit, writeFileAtomic } from "./atomic-file";
import { jsonIndentOf, parseJsonObject } from "./json-object";

export const MAX_JSON_EDIT_BYTES = 4 * 1024 * 1024;
const ATTEMPTS = 3;

/** Changes `value` in place; `false`: nothing to change; a string: why the file must not be changed. */
export type JsonObjectChange = (value: Record<string, unknown>) => boolean | string;

export type JsonEditResult =
	| { readonly status: "changed" | "unchanged" | "absent"; readonly path: string }
	| { readonly status: "refused"; readonly path: string; readonly reason: string };

export interface JsonEditOptions {
	/** Mode of a file this edit creates; undefined: a missing file stays missing (`absent`). */
	readonly createMode?: number;
	/** Why a file that parses still must not be rewritten (a key written twice, a number a double cannot hold). */
	readonly lossy?: (text: string) => string | undefined;
}

export async function editJsonObjectFile(
	given: string,
	change: JsonObjectChange,
	options: JsonEditOptions = {},
): Promise<JsonEditResult> {
	const path = await realpath(given).catch(() => given);
	try {
		for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
			const done = await editOnce(path, change, options);
			if (done !== undefined) return done;
		}
		return { status: "refused", path, reason: "the file kept changing while it was being edited" };
	} catch (error) {
		return { status: "refused", path, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** Undefined: the file changed between the read and the write, so read again. */
async function editOnce(
	path: string,
	change: JsonObjectChange,
	options: JsonEditOptions,
): Promise<JsonEditResult | undefined> {
	const read = await readFileForEdit(path, MAX_JSON_EDIT_BYTES);
	if (read.status === "too_large")
		return { status: "refused", path, reason: `${path} is larger than ${MAX_JSON_EDIT_BYTES} bytes` };
	if (read.status === "missing" && options.createMode === undefined) return { status: "absent", path };
	const text = read.status === "read" ? read.text : undefined;
	const parsed = text === undefined || text.trim() === "" ? { value: {} } : parseJsonObject(text);
	if ("problem" in parsed)
		return { status: "refused", path, reason: `${path} is not strict JSON (${parsed.problem}); left as it is` };
	const lossy = text === undefined ? undefined : options.lossy?.(text);
	if (lossy !== undefined)
		return { status: "refused", path, reason: `${path} cannot be rewritten without changing it: ${lossy}` };
	const changed = change(parsed.value);
	if (typeof changed === "string") return { status: "refused", path, reason: changed };
	if (!changed) return { status: "unchanged", path };
	const next = `${JSON.stringify(parsed.value, null, jsonIndentOf(text ?? ""))}\n`;
	const mode = read.status === "read" ? read.mode : options.createMode;
	return (await writeFileAtomic(path, next, { mode, unchangedFrom: text })) ? { status: "changed", path } : undefined;
}
