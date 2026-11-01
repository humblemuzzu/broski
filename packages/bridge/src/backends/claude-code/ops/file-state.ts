/** A config file as the phone sees it: its text within the contract's bound and the revision a write must quote. */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import { isMissing } from "./contained-path";

export const ABSENT_REVISION = "absent";
/** A UTF-16 unit takes at most three UTF-8 bytes, so a file longer than this cannot fit the contract's text bound. */
const MAX_READ_BYTES = 3 * MAX_TEXT_CHARS;

export interface FileState {
	readonly exists: boolean;
	readonly text: string;
	readonly revision: string;
	readonly truncated: boolean;
	/** Whether `text` is a faithful copy of the file, so writing it back loses nothing. */
	readonly faithful: boolean;
	readonly problems: readonly string[];
}

const ABSENT: FileState = {
	exists: false,
	text: "",
	revision: ABSENT_REVISION,
	truncated: false,
	faithful: true,
	problems: [],
};

export function revisionOfBytes(bytes: Uint8Array): string {
	return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

export function revisionOfText(text: string): string {
	return revisionOfBytes(new TextEncoder().encode(text));
}

function unreadable(path: string, why: string): FileState {
	return { ...ABSENT, exists: true, revision: "unreadable", faithful: false, problems: [`${path}: ${why}`] };
}

export async function readFileState(path: string): Promise<FileState> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch (error) {
		if (isMissing(error)) return ABSENT;
		return unreadable(path, error instanceof Error ? error.message : String(error));
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) return unreadable(path, "it is not a regular file");
		const buffer = Buffer.alloc(Math.min(info.size, MAX_READ_BYTES));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const bytes = buffer.subarray(0, bytesRead);
		if (info.size > MAX_READ_BYTES) return longer(path, bytes, `${info.size}-${info.mtimeMs}`);
		return decoded(path, bytes);
	} catch (error) {
		return unreadable(path, error instanceof Error ? error.message : String(error));
	} finally {
		await handle.close();
	}
}

function longer(path: string, head: Uint8Array, stamp: string): FileState {
	const { text } = decode(head);
	return {
		exists: true,
		text: clip(text, MAX_TEXT_CHARS),
		revision: `long-${stamp}`,
		truncated: true,
		faithful: false,
		problems: [
			`${path} is longer than the ${MAX_TEXT_CHARS} characters shown here, so it cannot be edited from the phone`,
		],
	};
}

function decoded(path: string, bytes: Uint8Array): FileState {
	const { text, valid } = decode(bytes);
	const revision = revisionOfBytes(bytes);
	if (text.length > MAX_TEXT_CHARS) {
		const problem = `${path} is longer than the ${MAX_TEXT_CHARS} characters shown here, so it cannot be edited from the phone`;
		return {
			exists: true,
			text: clip(text, MAX_TEXT_CHARS),
			revision,
			truncated: true,
			faithful: false,
			problems: [problem],
		};
	}
	const problems = valid ? [] : [`${path} is not valid UTF-8, so it cannot be edited from the phone`];
	return { exists: true, text, revision, truncated: false, faithful: valid, problems };
}

function decode(bytes: Uint8Array): { text: string; valid: boolean } {
	try {
		return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), valid: true };
	} catch {
		return { text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes), valid: false };
	}
}
