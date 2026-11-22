import { createReadStream } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fnv1a } from "./types";

const CHUNK_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const GUARD_BYTES = 64;
const MAX_ZSTD_BYTES = 128 * 1024 * 1024;

export async function walkFiles(roots: readonly string[], accept: (filePath: string) => boolean): Promise<string[]> {
	const out: string[] = [];
	const stack = [...roots];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile() && accept(full)) out.push(full);
		}
	}
	return out;
}

export async function computeGuardHash(path: string, offset: number): Promise<string> {
	if (offset <= 0) return "";
	const fh = await open(path, "r").catch(() => undefined);
	if (!fh) return "";
	try {
		const len = Math.min(GUARD_BYTES, offset);
		const buf = Buffer.allocUnsafe(len);
		const { bytesRead } = await fh.read(buf, 0, len, offset - len);
		if (bytesRead <= 0) return "";
		return fnv1a(buf.subarray(0, bytesRead));
	} finally {
		await fh.close();
	}
}

export async function canResumeFile(
	path: string,
	offset: number,
	size: number,
	expectedGuardHash: string,
): Promise<boolean> {
	if (offset <= 0) return true;
	if (size < offset) return false;
	const fh = await open(path, "r").catch(() => undefined);
	if (!fh) return false;
	try {
		const len = Math.min(GUARD_BYTES, offset);
		const buf = Buffer.allocUnsafe(len);
		const { bytesRead } = await fh.read(buf, 0, len, offset - len);
		if (bytesRead !== len) return false;
		if (buf[len - 1] !== 10) return false;
		if (expectedGuardHash && fnv1a(buf) !== expectedGuardHash) return false;
		return true;
	} finally {
		await fh.close();
	}
}

export interface StreamResult {
	readonly offset: number;
	readonly bytesRead: number;
	readonly guardHash: string;
}

export async function streamJsonl(
	path: string,
	startOffset: number,
	onLine: (line: Buffer, nextOffset: number) => void,
	signal?: AbortSignal,
): Promise<StreamResult> {
	if (path.endsWith(".zst")) {
		return streamZstdJsonl(path, onLine, signal);
	}
	const stream = createReadStream(path, { start: startOffset, highWaterMark: CHUNK_BYTES });
	let pending: Buffer[] = [];
	let pendingBytes = 0;
	let oversized = false;
	let consumed = startOffset;
	let bytesRead = 0;

	try {
		for await (const rawChunk of stream) {
			if (signal?.aborted) break;
			const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
			bytesRead += chunk.length;
			let start = 0;
			let nl = chunk.indexOf(10, start);
			while (nl !== -1) {
				const piece = chunk.subarray(start, nl);
				const lineLen = pendingBytes + piece.length;
				const nextOffset = consumed + lineLen + 1;
				if (!oversized && lineLen > 0 && lineLen <= MAX_LINE_BYTES) {
					const line = pending.length > 0 ? Buffer.concat([...pending, piece], lineLen) : piece;
					onLine(line, nextOffset);
				}
				consumed = nextOffset;
				pending = [];
				pendingBytes = 0;
				oversized = false;
				start = nl + 1;
				nl = chunk.indexOf(10, start);
			}
			if (start < chunk.length) {
				const rem = chunk.subarray(start);
				pendingBytes += rem.length;
				if (pendingBytes > MAX_LINE_BYTES) {
					oversized = true;
					pending = [];
				} else if (!oversized) {
					pending.push(Buffer.from(rem));
				}
			}
		}
	} finally {
		stream.destroy();
	}

	const guardHash = await computeGuardHash(path, consumed);
	return { offset: consumed, bytesRead, guardHash };
}

async function streamZstdJsonl(
	path: string,
	onLine: (line: Buffer, nextOffset: number) => void,
	signal?: AbortSignal,
): Promise<StreamResult> {
	const compressed = await readFile(path);
	if (signal?.aborted || compressed.byteLength === 0) return { offset: 0, bytesRead: 0, guardHash: "" };
	const raw = Bun.zstdDecompressSync(compressed);
	if (raw.byteLength > MAX_ZSTD_BYTES) return { offset: 0, bytesRead: compressed.byteLength, guardHash: "" };
	const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
	let start = 0;
	let nl = buf.indexOf(10, start);
	while (nl !== -1) {
		if (signal?.aborted) break;
		const len = nl - start;
		if (len > 0 && len <= MAX_LINE_BYTES) onLine(buf.subarray(start, nl), 0);
		start = nl + 1;
		nl = buf.indexOf(10, start);
	}
	if (start < buf.length && buf.length - start <= MAX_LINE_BYTES && !signal?.aborted) {
		onLine(buf.subarray(start), 0);
	}
	return { offset: 0, bytesRead: compressed.byteLength, guardHash: "" };
}

export function yieldSlice(ms = 8): Promise<void> {
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		t.unref?.();
	});
}
