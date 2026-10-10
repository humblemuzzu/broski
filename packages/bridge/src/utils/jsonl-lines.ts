/**
 * Streaming JSONL line reader.
 *
 * Bytes are read into one reused buffer and decoded incrementally; a line is accumulated as a list
 * of decoded chunk slices that are joined once, so neither the whole file nor a long line is ever
 * copied repeatedly. Lines are yielded without their `\n` / `\r\n` terminator; empty lines yield
 * `""`. A `chunkBytes` read boundary may fall inside a multi-byte character — the streaming decoder
 * holds the split sequence until the next chunk.
 */

import { open } from "node:fs/promises";

export type ReadJsonlLinesOptions = {
	/** Stop after reading this many bytes. */
	maxBytes?: number;
	/** Byte offset to start at. A line straddling the offset is yielded as a partial first line. */
	startOffset?: number;
	/** Bytes held in the reused read buffer. */
	chunkBytes?: number;
	signal?: AbortSignal;
};

export type ReadJsonlHeadOptions = {
	maxLines?: number;
	maxBytes?: number;
	/** Called per line; returning `true` stops after that line (inclusive). */
	until?: (line: string, index: number) => boolean;
};

export const DEFAULT_JSONL_CHUNK_BYTES = 1024 * 1024;

export const stripCarriageReturn = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

const joinPieces = (pieces: string[]): string => (pieces.length === 1 ? pieces[0]! : pieces.join(""));

function consumeChunk(chunk: string, pieces: string[], completed: string[]): string[] {
	let start = 0;
	while (true) {
		const newline = chunk.indexOf("\n", start);
		if (newline === -1) {
			if (start < chunk.length) pieces.push(chunk.slice(start));
			return pieces;
		}
		pieces.push(chunk.slice(start, newline));
		completed.push(stripCarriageReturn(joinPieces(pieces)));
		pieces = [];
		start = newline + 1;
	}
}

export async function* readJsonlLines(
	path: string,
	options: ReadJsonlLinesOptions = {},
): AsyncGenerator<string, void, undefined> {
	const {
		startOffset = 0,
		maxBytes = Number.POSITIVE_INFINITY,
		chunkBytes = DEFAULT_JSONL_CHUNK_BYTES,
		signal,
	} = options;
	if (chunkBytes <= 0 || maxBytes <= 0) return;

	// A chunk larger than the runtime can allocate throws here; allocating after `open` would leak the fd.
	const buffer = Buffer.allocUnsafe(chunkBytes);
	const handle = await open(path, "r");
	const decoder = new TextDecoder("utf-8");
	const completed: string[] = [];
	let pieces: string[] = [];
	let position = startOffset;
	let remaining = maxBytes;

	try {
		while (remaining > 0) {
			signal?.throwIfAborted();
			const { bytesRead } = await handle.read(buffer, 0, Math.min(chunkBytes, remaining), position);
			if (bytesRead === 0) break;
			position += bytesRead;
			remaining -= bytesRead;
			pieces = consumeChunk(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }), pieces, completed);
			for (const line of completed) yield line;
			completed.length = 0;
		}
	} finally {
		await handle.close();
	}

	pieces = consumeChunk(decoder.decode(), pieces, completed);
	for (const line of completed) yield line;
	if (pieces.length > 0) yield stripCarriageReturn(joinPieces(pieces));
}

/** Returns the first lines of a JSONL file, for `session meta + first user message` scans. */
export async function readJsonlHead(path: string, options: ReadJsonlHeadOptions = {}): Promise<string[]> {
	const { maxLines, maxBytes, until } = options;
	if (maxLines !== undefined && maxLines <= 0) return [];
	const lines: string[] = [];
	for await (const line of readJsonlLines(path, { maxBytes })) {
		lines.push(line);
		if (until?.(line, lines.length - 1) === true) break;
		if (maxLines !== undefined && lines.length >= maxLines) break;
	}
	return lines;
}
