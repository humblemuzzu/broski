/**
 * Reading a user file for an edit and writing it back whole: the new text goes to a temporary file beside the old one
 * and is renamed over it, so a crash leaves one or the other, never half. The adapter has its own copy of this
 * (`backends/claude-code/files/`), which its layer rule keeps from importing here.
 */

import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type FileForEdit =
	| { readonly status: "missing" }
	| { readonly status: "read"; readonly text: string; readonly mode: number }
	| { readonly status: "too_large"; readonly size: number };

export interface AtomicWriteOptions {
	/** The new file's exact mode; undefined: 0644 less the umask. */
	readonly mode?: number;
	readonly dirMode?: number;
	/** The text the file must still hold (undefined: must still be absent) when the new one replaces it. */
	readonly unchangedFrom?: string | undefined;
}

export function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

/** The file's text and mode, or that it is not there; any other failure throws. */
export async function readFileForEdit(path: string, maxBytes: number): Promise<FileForEdit> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch (error) {
		if (isMissingFile(error)) return { status: "missing" };
		throw error;
	}
	try {
		const info = await handle.stat();
		if (info.size > maxBytes) return { status: "too_large", size: info.size };
		return { status: "read", text: await handle.readFile("utf8"), mode: info.mode & 0o7777 };
	} finally {
		await handle.close();
	}
}

/** True when `path` now holds `text`; false when `unchangedFrom` no longer matched. Throws what the filesystem throws. */
export async function writeFileAtomic(path: string, text: string, options: AtomicWriteOptions = {}): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true, ...(options.dirMode !== undefined && { mode: options.dirMode }) });
	const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		const handle = await open(temp, "wx", options.mode ?? 0o644);
		try {
			await handle.writeFile(text, "utf8");
			if (options.mode !== undefined) await handle.chmod(options.mode);
			await handle.sync();
		} finally {
			await handle.close();
		}
		if ("unchangedFrom" in options && (await currentText(path)) !== options.unchangedFrom) return false;
		await rename(temp, path);
		return true;
	} finally {
		await unlink(temp).catch(() => undefined);
	}
}

async function currentText(path: string): Promise<string | undefined> {
	const read = await readFileForEdit(path, Number.MAX_SAFE_INTEGER);
	return read.status === "read" ? read.text : undefined;
}
