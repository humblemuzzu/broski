/**
 * When a session's conversation last moved: the newest `user` or `assistant` entry's `timestamp` near the end of the
 * transcript (D24). Not the file's mtime: a CLI that resumed the session appends unstamped bookkeeping (`cost-state`,
 * `session-owner`, …) when it ends, so merely opening a session from the phone would make it look new again.
 * Cached by the file's size and mtime.
 */

import { open } from "node:fs/promises";
import { isRecord } from "../json";
import { boundedGrowth } from "./bounded";
import { stampOf } from "./locator";
import { MAX_RAW_LINE_BYTES } from "./raw-scan";

const FIRST_WINDOW_BYTES = 65_536;
const MAX_CACHED = 20_000;
const NEWLINE = 0x0a;
const MESSAGE_TYPE = /"type":\s*"(?:user|assistant)"/;

export class ActivityTimes {
	private readonly known = new Map<string, { readonly stamp: string; readonly at: number }>();

	/**
	 * The session's `updatedAt`: its last message's time, never later than the file's mtime, which it falls back to
	 * when no message is within reach. Undefined when the file cannot be read.
	 */
	async updatedAt(path: string): Promise<number | undefined> {
		const stamp = await stampOf(path);
		if (stamp === undefined) return undefined;
		const key = `${stamp.size}:${stamp.mtimeMs}`;
		const cached = this.known.get(path);
		if (cached?.stamp === key) return cached.at;
		const mtime = Math.trunc(stamp.mtimeMs);
		const at = Math.min(mtime, (await lastMessageAt(path, stamp.size)) ?? mtime);
		this.known.delete(path);
		this.known.set(path, { stamp: key, at });
		boundedGrowth(this.known, MAX_CACHED);
		return at;
	}
}

/** The window grows until it holds a message, to the file's start or one longest line past the first window. */
async function lastMessageAt(path: string, size: number): Promise<number | undefined> {
	try {
		const handle = await open(path, "r");
		try {
			for (let window = FIRST_WINDOW_BYTES; ; window *= 4) {
				const from = Math.max(0, size - window);
				const buffer = Buffer.alloc(size - from);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
				const at = newestMessageIn(buffer.subarray(0, bytesRead), from > 0);
				if (at !== undefined || from === 0 || window > MAX_RAW_LINE_BYTES) return at;
			}
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

/**
 * The newest time among the complete lines of `bytes`. A window that begins inside a line drops that piece, and a
 * last line without its newline is still being written; neither is read as an entry.
 */
function newestMessageIn(bytes: Buffer, torn: boolean): number | undefined {
	let newest: number | undefined;
	let start = torn ? bytes.indexOf(NEWLINE) + 1 : 0;
	if (torn && start === 0) return undefined;
	for (let end = bytes.indexOf(NEWLINE, start); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
		const at = messageTime(bytes.toString("utf8", start, end));
		if (at !== undefined && (newest === undefined || at > newest)) newest = at;
		start = end + 1;
	}
	return newest;
}

function messageTime(line: string): number | undefined {
	if (!MESSAGE_TYPE.test(line)) return undefined;
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(entry) || (entry.type !== "user" && entry.type !== "assistant") || entry.isSidechain === true)
		return undefined;
	const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
	return Number.isFinite(at) && at > 0 ? Math.trunc(at) : undefined;
}
