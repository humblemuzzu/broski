/**
 * Whether a directory that may not exist yet lies inside one of the roots a write may land in, once every link on
 * the way is followed: a symlinked directory, or a root that is itself a link (`~/.pi` kept in a dotfiles
 * repository), cannot lead a write out. What exists is resolved with `realpath`; what does not exist yet cannot be a
 * link, so it is appended as written.
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export async function isInsideRoots(roots: readonly string[], dir: string): Promise<boolean> {
	const target = await realTarget(resolve(dir));
	for (const root of roots) {
		const inside = relative(await realTarget(resolve(root)), target);
		if (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) return true;
	}
	return false;
}

async function realTarget(path: string): Promise<string> {
	const rest: string[] = [];
	let existing = path;
	for (;;) {
		try {
			return join(await realpath(existing), ...[...rest].reverse());
		} catch (error) {
			const parent = dirname(existing);
			if (!isMissing(error) || parent === existing) throw error;
			rest.push(basename(existing));
			existing = parent;
		}
	}
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
