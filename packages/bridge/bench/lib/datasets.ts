import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatasetInfo } from "./types";
import { walkFiles } from "./walk";

async function collectJsonlDataset(id: string, root: string): Promise<DatasetInfo> {
	const files = await walkFiles(root, (name) => name.endsWith(".jsonl"));
	let bytes = 0;
	let largestPath: string | null = null;
	let largestBytes = 0;
	for (const file of files) {
		bytes += file.bytes;
		if (file.bytes > largestBytes) {
			largestBytes = file.bytes;
			largestPath = file.path;
		}
	}
	return { id, root, exists: files.length > 0, files: files.length, bytes, largestPath, largestBytes };
}

function collectSingleFile(id: string, path: string): DatasetInfo {
	try {
		const info = statSync(path);
		return {
			id,
			root: path,
			exists: true,
			files: 1,
			bytes: info.size,
			largestPath: path,
			largestBytes: info.size,
		};
	} catch {
		return { id, root: path, exists: false, files: 0, bytes: 0, largestPath: null, largestBytes: 0 };
	}
}

export async function collectDatasets(): Promise<DatasetInfo[]> {
	const home = homedir();
	return [
		await collectJsonlDataset("codex-sessions", join(home, ".codex", "sessions")),
		await collectJsonlDataset("codex-archived-sessions", join(home, ".codex", "archived_sessions")),
		await collectJsonlDataset("claude-code-projects", join(home, ".claude", "projects")),
		collectSingleFile("codex-state-db", join(home, ".codex", "state_5.sqlite")),
	];
}
