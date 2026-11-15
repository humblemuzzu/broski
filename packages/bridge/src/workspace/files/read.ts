import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import type { FileEncoding, FsReadResult } from "../../contract";
import { rejected } from "../results";
import { fileSystemRejection } from "./errors";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * At most `length` bytes of the file `path` (canonical, past the path policy) from `offset`: as text when they
 * are UTF-8 without a NUL, ending on a whole character, else as base64. The file is opened without following a
 * link, so one swapped in after the policy looked is refused.
 */
export async function readFileSlice(path: string, offset: number, length: number): Promise<FsReadResult> {
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		return fileSystemRejection(error, path);
	}
	try {
		const stats = await handle.stat();
		if (stats.isDirectory()) return rejected("invalid_input", `${path} is a directory`);
		if (!stats.isFile()) return rejected("invalid_input", `${path} is not a regular file`);
		const start = Math.min(offset, stats.size);
		const bytes = await readAt(handle, start, Math.min(length, stats.size - start));
		const { encoding, content, used } = encoded(bytes, start + bytes.length < stats.size);
		return {
			status: "accepted",
			path,
			encoding,
			content,
			offset: start,
			length: used,
			size: stats.size,
			truncated: start + used < stats.size,
		};
	} catch (error) {
		return fileSystemRejection(error, path);
	} finally {
		await handle.close();
	}
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Uint8Array> {
	const buffer = new Uint8Array(length);
	let filled = 0;
	while (filled < length) {
		const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
		if (bytesRead === 0) break;
		filled += bytesRead;
	}
	return buffer.subarray(0, filled);
}

/**
 * Text when the bytes decode as UTF-8 without a NUL, leaving out a character the read cut short when more of the
 * file follows. Base64 otherwise, and also when the text would cover no byte at all, so a reader always advances.
 */
function encoded(bytes: Uint8Array, more: boolean): { encoding: FileEncoding; content: string; used: number } {
	const whole = more ? bytes.subarray(0, bytes.length - cutCharacter(bytes)) : bytes;
	if ((whole.length > 0 || bytes.length === 0) && !whole.includes(0)) {
		try {
			return { encoding: "utf8", content: strictUtf8.decode(whole), used: whole.length };
		} catch {
			// Not UTF-8: sent as bytes.
		}
	}
	return { encoding: "base64", content: Buffer.from(bytes).toString("base64"), used: bytes.length };
}

/** How many bytes at the end begin a UTF-8 character that continues past them: 0 to 3. */
function cutCharacter(bytes: Uint8Array): number {
	for (let back = 1; back <= Math.min(3, bytes.length); back += 1) {
		const byte = bytes[bytes.length - back] ?? 0;
		if ((byte & 0xc0) === 0x80) continue;
		const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
		return width > back ? back : 0;
	}
	return 0;
}
