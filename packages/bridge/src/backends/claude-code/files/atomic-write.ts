/** The one temporary-file-then-rename write: a crash or a refusal leaves the old file or the new one, never half of one. */

import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
	/** The new file's exact mode; undefined: 0644 less the umask. */
	readonly mode?: number;
	/** Mode of a parent directory this write has to create. */
	readonly dirMode?: number;
	/** Asked once the new file is complete, just before it replaces the old one: false leaves the old file as it is. */
	readonly stillWanted?: () => Promise<boolean>;
}

/** Writes `text` into a new, synced file beside `path` and returns its name; the caller renames or unlinks it. */
async function writeTempBeside(path: string, text: string, mode: number | undefined): Promise<string> {
	const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
	const handle = await open(temp, "wx", mode ?? 0o644);
	try {
		await handle.writeFile(text, "utf8");
		if (mode !== undefined) await handle.chmod(mode);
		await handle.sync();
	} catch (error) {
		await handle.close();
		await unlink(temp).catch(() => undefined);
		throw error;
	}
	await handle.close();
	return temp;
}

/** True when `path` now holds `text`; false when `stillWanted` said no. Throws what the filesystem throws. */
export async function writeAtomic(path: string, text: string, options: AtomicWriteOptions = {}): Promise<boolean> {
	await mkdir(dirname(path), { recursive: true, ...(options.dirMode !== undefined && { mode: options.dirMode }) });
	const temp = await writeTempBeside(path, text, options.mode);
	try {
		if (options.stillWanted && !(await options.stillWanted())) return false;
		await rename(temp, path);
		return true;
	} finally {
		await unlink(temp).catch(() => undefined);
	}
}
