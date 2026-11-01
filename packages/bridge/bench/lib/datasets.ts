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

export async function collectDatasets(): Promise<DatasetInfo[]> {
	const home = homedir();
	return [await collectJsonlDataset("claude-code-projects", join(home, ".claude", "projects"))];
}
