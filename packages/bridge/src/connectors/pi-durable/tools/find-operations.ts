import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { FindOperations } from "@earendil-works/pi-coding-agent";
import { pathExists, walkFiles } from "./fs-walk";
import { matchesGlob } from "./glob-match";

export async function matchFilePaths(
	root: string,
	pattern: string,
	limit: number,
	ignore: readonly string[],
): Promise<string[]> {
	if (limit <= 0) return [];
	const target = await stat(root).catch(() => undefined);
	if (target !== undefined && !target.isDirectory()) {
		const name = basename(root);
		return matchesGlob(name, pattern) ? [name] : [];
	}
	const matches: string[] = [];
	await walkFiles(root, {
		ignore,
		onFile: (_absolutePath, relativePath) => {
			if (!matchesGlob(relativePath, pattern)) return true;
			matches.push(relativePath);
			return matches.length < limit;
		},
	});
	return matches;
}

export function createPiDurableFindOperations(): FindOperations {
	return {
		exists: pathExists,
		glob: (pattern, searchPath, options) => matchFilePaths(searchPath, pattern, options.limit, options.ignore),
	};
}
