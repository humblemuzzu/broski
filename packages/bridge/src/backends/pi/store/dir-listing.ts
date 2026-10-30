/**
 * The `.jsonl` files of the session directories and their stamps. A directory or file that is not there is empty
 * or absent; a read that failed for another reason (`EMFILE`, `EIO`…) throws, because the index would otherwise
 * take every file of the directory for removed.
 */

import { readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type FileStamp, stampOf } from "./jsonl-reader";
import { isAbsentFileError } from "./open-file";
import { mapPool } from "./pool";

export interface ListedFile {
	readonly path: string;
	readonly stamp: FileStamp;
}

const STAT_CONCURRENCY = 16;

/** The stamp of the regular file at `path`; undefined when there is none. */
export async function statStamp(path: string): Promise<FileStamp | undefined> {
	try {
		const stats = await stat(path);
		return stats.isFile() ? stampOf(stats) : undefined;
	} catch (error) {
		if (isAbsentFileError(error)) return undefined;
		throw error;
	}
}

/** The regular files among `paths`, with their stamps. */
export async function statFiles(paths: readonly string[]): Promise<ListedFile[]> {
	const stamps = await mapPool(paths, STAT_CONCURRENCY, statStamp);
	const files: ListedFile[] = [];
	stamps.forEach((stamp, position) => {
		const path = paths[position];
		if (stamp !== undefined && path !== undefined) files.push({ path, stamp });
	});
	return files;
}

export async function jsonlFilesIn(dirs: readonly string[]): Promise<string[]> {
	const names = await Promise.all(
		dirs.map(async (dir) => {
			try {
				return (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name));
			} catch (error) {
				if (isAbsentFileError(error)) return [];
				throw error;
			}
		}),
	);
	return names.flat();
}

/**
 * The files there now and their stamps, read synchronously so that nothing can appear between this and the
 * watcher opened right after it. A file it cannot read is left out, which makes it news when it is next found.
 */
export function filesNowIn(dir: string): ListedFile[] {
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return [];
	}
	return names.flatMap((name) => {
		const path = join(dir, name);
		const stamp = stampNow(path);
		return stamp === undefined ? [] : [{ path, stamp }];
	});
}

function stampNow(path: string): FileStamp | undefined {
	try {
		const stats = statSync(path);
		return stats.isFile() ? stampOf(stats) : undefined;
	} catch {
		return undefined;
	}
}
