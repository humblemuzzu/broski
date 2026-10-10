/**
 * Reads the last N lines of a JSONL file by seeking backwards from EOF in fixed-size chunks, so
 * serving a 200-message transcript never reads a 400 MB session file. A chunk boundary that lands
 * inside a line is handled by decoding the concatenated suffix in one pass.
 */

import { type FileHandle, open } from "node:fs/promises";
import { stripCarriageReturn } from "./jsonl-lines";

/** The part of a `FileHandle` a tail read needs, so a test can supply one that reads short. */
export type TailFileHandle = {
	stat(): Promise<{ size: number }>;
	read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
	close(): Promise<void>;
};

export type ReadJsonlTailOptions = {
	maxLines: number;
	/** Upper bound on bytes read from EOF. */
	maxBytes?: number;
	chunkSize?: number;
	/** Injectable for tests; defaults to `open`. */
	openHandle?: (path: string) => Promise<TailFileHandle>;
};

const openFile = (path: string): Promise<FileHandle> => open(path, "r");

const DEFAULT_TAIL_CHUNK_BYTES = 256 * 1024;
const NEWLINE = 10;

async function isNewlineAt(handle: TailFileHandle, position: number): Promise<boolean> {
	const probe = Buffer.allocUnsafe(1);
	const { bytesRead } = await handle.read(probe, 0, 1, position);
	return bytesRead === 1 && probe[0] === NEWLINE;
}

function countNewlines(buffer: Buffer): number {
	let count = 0;
	for (let index = 0; index < buffer.length; index++) if (buffer[index] === NEWLINE) count++;
	return count;
}

export async function readJsonlTail(path: string, options: ReadJsonlTailOptions): Promise<string[]> {
	const {
		maxLines,
		maxBytes = Number.POSITIVE_INFINITY,
		chunkSize = DEFAULT_TAIL_CHUNK_BYTES,
		openHandle = openFile,
	} = options;
	if (maxLines <= 0 || maxBytes <= 0 || chunkSize <= 0) return [];

	const handle = await openHandle(path);
	try {
		const { size } = await handle.stat();
		if (size === 0) return [];

		const parts: Buffer[] = [];
		let start = size;
		let newlines = 0;
		let bytesRead = 0;

		while (start > 0 && bytesRead < maxBytes) {
			const length = Math.min(chunkSize, start, maxBytes - bytesRead);
			const chunkStart = start - length;
			const buffer = Buffer.allocUnsafe(length);
			// A file truncated after the `stat` reads short, and the rest of the buffer is uninitialised.
			const { bytesRead: read } = await handle.read(buffer, 0, length, chunkStart);
			const chunk = read < length ? buffer.subarray(0, read) : buffer;
			parts.push(chunk);
			bytesRead += read;
			start = chunkStart;
			newlines += countNewlines(chunk);
			if (start === 0 || newlines > maxLines) break;
			if (newlines === maxLines && (await isNewlineAt(handle, start - 1))) break;
		}

		const suffix = Buffer.concat(parts.reverse());
		const lines = suffix.toString("utf8").split("\n");
		if (lines[lines.length - 1] === "") lines.pop();
		if (start > 0 && lines.length > 0 && !(await isNewlineAt(handle, start - 1))) lines.shift();
		return (lines.length > maxLines ? lines.slice(-maxLines) : lines).map(stripCarriageReturn);
	} finally {
		await handle.close();
	}
}
