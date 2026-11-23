/**
 * Splits a file into lines on LF only, by byte span, without decoding the lines. Pi's own docs forbid
 * `readline` for session files because it also splits on U+2028/U+2029 (pi-coding-agent `docs/json.md`);
 * a line is a run of bytes up to `\n`, and a visitor sees where it lies and how it begins.
 */

import type { FileHandle } from "node:fs/promises";

const BLOCK_BYTES = 1 << 20;

/** How many leading bytes of a line a visitor sees: an entry's type, ids and role all sit in the first 200. */
const HEAD_BYTES = 512;

/**
 * A line longer than this is never read whole, so a corrupt or hostile file cannot make the bridge allocate its size.
 * Real tool results reach tens of megabytes (36 MB has been seen), and one that size parses in about 40 ms.
 */
export const MAX_LINE_BYTES = 64 * 1024 * 1024;

export interface ScannedLine {
	readonly offset: number;
	/** Bytes up to, not including, the `\n`. */
	readonly length: number;
	/** The first `HEAD_BYTES` bytes as Latin-1: ASCII structure is exact, any other byte is a placeholder. */
	readonly head: string;
	/** False for the last line of a file that does not end in `\n`: a writer may still be appending it. */
	readonly terminated: boolean;
}

export type ScanSignal = "stop" | undefined;
export type LineVisitor = (line: ScannedLine) => ScanSignal | Promise<ScanSignal>;

/** Visits the lines that start in `[from, to)`; the first is the rest of a line when `from` falls inside one. Stops early on `"stop"`. */
export async function scanLines(handle: FileHandle, from: number, to: number, visit: LineVisitor): Promise<void> {
	const block = Buffer.allocUnsafe(Math.max(1, Math.min(BLOCK_BYTES, to - from)));
	const head = Buffer.allocUnsafe(HEAD_BYTES);
	let headLength = 0;
	let lineStart = from;
	let position = from;
	while (position < to) {
		const { bytesRead } = await handle.read(block, 0, Math.min(block.length, to - position), position);
		if (bytesRead === 0) break;
		const bytes = block.subarray(0, bytesRead);
		let cursor = 0;
		while (cursor < bytesRead) {
			const newline = bytes.indexOf(0x0a, cursor);
			const end = newline === -1 ? bytesRead : newline;
			headLength += bytes.copy(head, headLength, cursor, Math.min(end, cursor + HEAD_BYTES - headLength));
			if (newline === -1) break;
			const line = { offset: lineStart, length: position + newline - lineStart, head: latin1(head, headLength) };
			if ((await visit({ ...line, terminated: true })) === "stop") return;
			lineStart = position + newline + 1;
			headLength = 0;
			cursor = newline + 1;
		}
		position += bytesRead;
	}
	if (lineStart < position) {
		await visit({ offset: lineStart, length: position - lineStart, head: latin1(head, headLength), terminated: false });
	}
}

function latin1(bytes: Buffer, length: number): string {
	return bytes.toString("latin1", 0, length);
}

/** `length` bytes at `offset`, or undefined when the file is shorter (it was truncated) or `length` passes the line bound. */
export async function readBytes(handle: FileHandle, offset: number, length: number): Promise<Buffer | undefined> {
	if (length > MAX_LINE_BYTES) return undefined;
	const buffer = Buffer.allocUnsafe(length);
	let filled = 0;
	while (filled < length) {
		const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
		if (bytesRead === 0) return undefined;
		filled += bytesRead;
	}
	return buffer;
}

export async function readText(handle: FileHandle, offset: number, length: number): Promise<string | undefined> {
	return (await readBytes(handle, offset, length))?.toString("utf8");
}
