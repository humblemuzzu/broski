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

interface CachedTimes {
	readonly stamp: string;
	readonly at: number;
	readonly promptAt: number | undefined;
}

export class ActivityTimes {
	private readonly known = new Map<string, CachedTimes>();

	/**
	 * The session's `updatedAt`: its last message's time, never later than the file's mtime, which it falls back to
	 * when no message is within reach. Undefined when the file cannot be read.
	 */
	async updatedAt(path: string): Promise<number | undefined> {
		return (await this.read(path))?.at;
	}

	/** The newest human prompt's time near the end of the transcript (for an unopened running terminal session). */
	async promptAt(path: string): Promise<number | undefined> {
		return (await this.read(path))?.promptAt;
	}

	private async read(path: string): Promise<CachedTimes | undefined> {
		const stamp = await stampOf(path);
		if (stamp === undefined) return undefined;
		const key = `${stamp.size}:${stamp.mtimeMs}`;
		const cached = this.known.get(path);
		if (cached?.stamp === key) return cached;
		const mtime = Math.trunc(stamp.mtimeMs);
		const found = await lastMessageTimes(path, stamp.size);
		const entry: CachedTimes = {
			stamp: key,
			at: Math.min(mtime, found.at ?? mtime),
			promptAt: found.promptAt !== undefined ? Math.min(mtime, found.promptAt) : undefined,
		};
		this.known.delete(path);
		this.known.set(path, entry);
		boundedGrowth(this.known, MAX_CACHED);
		return entry;
	}
}

interface FoundTimes {
	readonly at: number | undefined;
	readonly promptAt: number | undefined;
}

/** The window grows until it holds a message, to the file's start or one longest line past the first window. */
async function lastMessageTimes(path: string, size: number): Promise<FoundTimes> {
	try {
		const handle = await open(path, "r");
		try {
			let at: number | undefined;
			let promptAt: number | undefined;
			for (let window = FIRST_WINDOW_BYTES; ; window *= 4) {
				const from = Math.max(0, size - window);
				const buffer = Buffer.alloc(size - from);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
				const found = newestMessagesIn(buffer.subarray(0, bytesRead), from > 0);
				at ??= found.at;
				promptAt ??= found.promptAt;
				if ((at !== undefined && promptAt !== undefined) || from === 0 || window > MAX_RAW_LINE_BYTES) {
					return { at, promptAt };
				}
			}
		} finally {
			await handle.close();
		}
	} catch {
		return { at: undefined, promptAt: undefined };
	}
}

/**
 * The newest times among the complete lines of `bytes`. A window that begins inside a line drops that piece, and a
 * last line without its newline is still being written; neither is read as an entry.
 */
function newestMessagesIn(bytes: Buffer, torn: boolean): FoundTimes {
	let newest: number | undefined;
	let newestPrompt: number | undefined;
	let start = torn ? bytes.indexOf(NEWLINE) + 1 : 0;
	if (torn && start === 0) return { at: undefined, promptAt: undefined };
	for (let end = bytes.indexOf(NEWLINE, start); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
		const parsed = messageTimes(bytes.toString("utf8", start, end));
		if (parsed !== undefined) {
			if (newest === undefined || parsed.at > newest) newest = parsed.at;
			if (parsed.isPrompt && (newestPrompt === undefined || parsed.at > newestPrompt)) newestPrompt = parsed.at;
		}
		start = end + 1;
	}
	return { at: newest, promptAt: newestPrompt };
}

function messageTimes(line: string): { readonly at: number; readonly isPrompt: boolean } | undefined {
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
	if (!Number.isFinite(at) || at <= 0) return undefined;
	const isPrompt =
		entry.type === "user" &&
		entry.isMeta !== true &&
		entry.isCompactSummary !== true &&
		hasPromptContent(entry.message);
	return { at: Math.trunc(at), isPrompt };
}

function hasPromptContent(message: unknown): boolean {
	if (!isRecord(message)) return false;
	const content = message.content;
	if (typeof content === "string") return content.trim().length > 0;
	if (!Array.isArray(content)) return false;
	return content.some((block) => isRecord(block) && block.type === "text" && typeof block.text === "string");
}
