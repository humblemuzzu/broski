/**
 * Line spans of a JSONL file: byte offset, byte length and a decoded head.
 *
 * Reads through one reused buffer and finds line ends with `Buffer.indexOf`, so the bytes of a
 * long line are never decoded, split or copied. A caller that only needs a few leading fields of
 * every line therefore pays one sequential read and nothing proportional to the line size.
 */

import { open } from "node:fs/promises";

export const DEFAULT_SPAN_CHUNK_BYTES = 1024 * 1024;
export const DEFAULT_SPAN_HEAD_BYTES = 4096;

export type JsonlLineSpan = {
	/** Byte offset of the line start. */
	offset: number;
	/** Byte length of the line, excluding the terminating `\n` (a preceding `\r` is included). */
	length: number;
	/** UTF-8 decode of the line's first `headBytes` bytes, or of the whole line when shorter. */
	head: string;
};

export type ReadJsonlLineSpansOptions = {
	chunkBytes?: number;
	headBytes?: number;
};

export async function* readJsonlLineSpans(
	path: string,
	options: ReadJsonlLineSpansOptions = {},
): AsyncGenerator<JsonlLineSpan, void, undefined> {
	const chunkBytes = options.chunkBytes ?? DEFAULT_SPAN_CHUNK_BYTES;
	const headBytes = options.headBytes ?? DEFAULT_SPAN_HEAD_BYTES;
	if (chunkBytes <= 0 || headBytes <= 0) return;

	const handle = await open(path, "r");
	const buffer = Buffer.allocUnsafe(chunkBytes);
	const head = Buffer.allocUnsafe(headBytes);
	const decoder = new TextDecoder("utf-8");

	let headFilled = 0;
	let lineStart = 0;
	let chunkStart = 0;
	let readOffset = 0;
	let filled = 0;
	let cursor = 0;

	const captureHead = (from: number, to: number): void => {
		if (headFilled >= headBytes || to <= from) return;
		const take = Math.min(to - from, headBytes - headFilled);
		head.set(buffer.subarray(from, from + take), headFilled);
		headFilled += take;
	};

	const decodeHead = (): string => (headFilled === 0 ? "" : decoder.decode(head.subarray(0, headFilled)));

	try {
		while (true) {
			if (cursor >= filled) {
				const { bytesRead } = await handle.read(buffer, 0, chunkBytes, readOffset);
				if (bytesRead === 0) break;
				chunkStart = readOffset;
				readOffset += bytesRead;
				filled = bytesRead;
				cursor = 0;
			}

			const newline = buffer.indexOf(0x0a, cursor);
			if (newline === -1 || newline >= filled) {
				captureHead(cursor, filled);
				cursor = filled;
				continue;
			}

			captureHead(cursor, newline);
			yield { offset: lineStart, length: chunkStart + newline - lineStart, head: decodeHead() };
			headFilled = 0;
			cursor = newline + 1;
			lineStart = chunkStart + newline + 1;
		}
	} finally {
		await handle.close();
	}

	if (headFilled > 0 && lineStart < readOffset) {
		yield { offset: lineStart, length: readOffset - lineStart, head: decodeHead() };
	}
}
