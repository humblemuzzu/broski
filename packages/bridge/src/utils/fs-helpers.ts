import { stat } from "node:fs/promises";

/**
 * Returns true only if `path` exists AND is a regular file.
 * Returns false for directories, missing paths, and permission errors.
 */
export async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

export async function dirExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isDirectory();
	} catch {
		return false;
	}
}
