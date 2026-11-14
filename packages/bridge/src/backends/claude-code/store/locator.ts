/** Where a session's transcript lies among the project directories, found without encoding a path (D23). */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { boundedGrowth } from "./bounded";

const MAX_CACHED = 4_096;

export interface FileStamp {
	readonly size: number;
	readonly mtimeMs: number;
}

export async function stampOf(path: string): Promise<FileStamp | undefined> {
	try {
		const stats = await stat(path);
		return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : undefined;
	} catch {
		return undefined;
	}
}

export async function projectDirNames(root: string): Promise<string[]> {
	try {
		const entries = await readdir(join(root, "projects"), {
			withFileTypes: true,
		});
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
}

export class FileLocator {
	private readonly known = new Map<string, string>();

	constructor(private readonly root: () => string) {}

	/** The transcript's path, or undefined when no project holds a non-empty `<sessionId>.jsonl`. */
	async find(sessionId: string): Promise<string | undefined> {
		const cached = this.known.get(sessionId);
		if (cached !== undefined && (await this.isTranscript(cached))) return cached;
		this.known.delete(sessionId);
		const root = this.root();
		for (const name of await projectDirNames(root)) {
			const path = join(root, "projects", name, `${sessionId}.jsonl`);
			if (await this.isTranscript(path)) {
				this.remember(sessionId, path);
				return path;
			}
		}
		return undefined;
	}

	forget(sessionId: string): void {
		this.known.delete(sessionId);
	}

	private remember(sessionId: string, path: string): void {
		this.known.set(sessionId, path);
		boundedGrowth(this.known, MAX_CACHED);
	}

	private async isTranscript(path: string): Promise<boolean> {
		const stamp = await stampOf(path);
		return stamp !== undefined && stamp.size > 0;
	}
}
