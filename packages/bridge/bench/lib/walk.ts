import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type FileEntry = { path: string; bytes: number };

export async function walkFiles(root: string, filter: (path: string) => boolean): Promise<FileEntry[]> {
	const out: FileEntry[] = [];
	const stack: string[] = [root];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (dir === undefined) continue;

		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) continue;

		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || !filter(full)) continue;
			try {
				const info = await stat(full);
				out.push({ path: full, bytes: info.size });
			} catch {}
		}
	}

	return out;
}

function pickLargest(files: FileEntry[]): FileEntry | null {
	let best: FileEntry | null = null;
	for (const file of files) {
		if (!best || file.bytes > best.bytes) best = file;
	}
	return best;
}

export async function largestFile(root: string, filter: (path: string) => boolean): Promise<FileEntry | null> {
	return pickLargest(await walkFiles(root, filter));
}
