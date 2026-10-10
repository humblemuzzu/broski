/**
 * Codex rollout file discovery.
 *
 * Walks the active and archived rollout directories for `.jsonl` files. Nothing is read from the
 * files here, so callers decide how much of each rollout to touch.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type RolloutRoots = {
	sessionsDir: string;
	archivedDir: string;
};

export function defaultRolloutRoots(): RolloutRoots {
	const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
	return { sessionsDir: join(codexHome, "sessions"), archivedDir: join(codexHome, "archived_sessions") };
}

async function scanRolloutDir(dir: string, files: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			await scanRolloutDir(fullPath, files);
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			files.push(fullPath);
		}
	}
}

export async function collectRolloutFiles(roots: RolloutRoots = defaultRolloutRoots()): Promise<string[]> {
	const files: string[] = [];
	await Promise.all([scanRolloutDir(roots.sessionsDir, files), scanRolloutDir(roots.archivedDir, files)]);
	return files;
}
