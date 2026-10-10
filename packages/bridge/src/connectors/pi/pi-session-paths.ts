/**
 * Where Pi keeps sessions, and how to find them.
 *
 * The layout is the SDK's: one directory per working directory under `~/.pi/agent/sessions`, named by
 * the encoded cwd, holding one `.jsonl` file per session. Kept apart from the listing so the
 * directory cache and the index-backed listing share one definition of the layout.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { piCodingAgent } from "../../sdk/pi-coding-agent";
import { runPool } from "../../utils/bounded-pool";

/** Concurrent `stat` calls while fingerprinting one directory. */
export const PI_SESSION_FINGERPRINT_CONCURRENCY = 16;

export type PiSessionFile = {
	path: string;
	mtimeMs: number;
	mtime: Date;
	size: number;
	ino: number;
	ctimeMs: number;
};

export const getPiSessionsRoot = (): string => resolve(piCodingAgent().getAgentDir(), "sessions");

const encodeCwdDir = (cwd: string): string =>
	`--${resolve(cwd)
		.replace(/^[/\\]/, "")
		.replace(/[/\\:]/g, "-")}--`;

export const defaultSessionDirForCwd = (cwd: string, root: string = getPiSessionsRoot()): string =>
	join(root, encodeCwdDir(cwd));

export async function listProjectDirs(root: string): Promise<string[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => join(root, entry.name));
	} catch {
		return [];
	}
}

/** Session file names in one project directory, sorted so a listing is deterministic. */
export async function listSessionFileNames(dir: string): Promise<string[]> {
	try {
		const names = await readdir(dir);
		return names.filter((name) => name.endsWith(".jsonl")).sort();
	} catch {
		return [];
	}
}

export async function statSessionFile(path: string): Promise<PiSessionFile | null> {
	try {
		const info = await stat(path);
		return { path, mtimeMs: info.mtimeMs, mtime: info.mtime, size: info.size, ino: info.ino, ctimeMs: info.ctimeMs };
	} catch {
		return null;
	}
}

export async function statSessionFiles(paths: string[]): Promise<PiSessionFile[]> {
	const files: Array<PiSessionFile | null> = paths.map(() => null);
	await runPool(
		paths.map((path, index) => ({ path, index })),
		PI_SESSION_FINGERPRINT_CONCURRENCY,
		async ({ path, index }) => {
			files[index] = await statSessionFile(path);
		},
	);
	return files.filter((file): file is PiSessionFile => file !== null);
}
