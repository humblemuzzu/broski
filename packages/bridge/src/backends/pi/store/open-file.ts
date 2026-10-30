/** Opening a session file to read it, so that nothing but a regular file is ever read and no open can block. */

import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

/** A failure of the file system (missing, unreadable, looping, out of descriptors: `ENOENT`, `EACCES`, `EMFILE`…), not a bug. */
export function isFileSystemError(error: unknown): error is Error & { readonly code: string } {
	return error instanceof Error && "code" in error && typeof error.code === "string" && /^E[A-Z0-9]+$/.test(error.code);
}

/**
 * The codes that say the path holds no file to read, now or later: gone, not a directory on the way, a link loop, a
 * directory, a device with nothing behind it, or one this user may not read. Anything else (`EMFILE`, `ENFILE`, `EIO`,
 * `EAGAIN`…) says the read failed this time, and a file that failed so is not "not a session".
 */
const ABSENT = new Set(["ENOENT", "ENOTDIR", "ELOOP", "EISDIR", "ENXIO", "EACCES", "EPERM", "ENAMETOOLONG"]);

export function isAbsentFileError(error: unknown): boolean {
	return isFileSystemError(error) && ABSENT.has(error.code);
}

/**
 * The open file at `path`, or undefined when there is none to read (`isAbsentFileError`) or it is not a regular file.
 * Any other failure throws: the caller answers it as a read that failed now, and remembers nothing from it. A named
 * pipe opened plainly blocks until a writer comes (open(2)), holding one of the few threads every file read shares;
 * opened with `O_NONBLOCK` it returns at once, and is refused here. The flag changes nothing for a regular file.
 */
export async function openRegularFile(path: string): Promise<FileHandle | undefined> {
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
	} catch (error) {
		if (isAbsentFileError(error)) return undefined;
		throw error;
	}
	try {
		if ((await handle.stat()).isFile()) return handle;
	} catch (error) {
		await handle.close();
		if (isAbsentFileError(error)) return undefined;
		throw error;
	}
	await handle.close();
	return undefined;
}
