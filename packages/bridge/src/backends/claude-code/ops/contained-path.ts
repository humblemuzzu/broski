/** Where a config file really is: inside its base after every symlink is followed, or not at all. */

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type Contained = { readonly real: string } | { readonly problem: string };

export function isContained(base: string, target: string): boolean {
	const inside = relative(base, target);
	return inside === "" || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside));
}

export function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** The path with its deepest existing ancestor resolved, so a file or directory not made yet still has a real place. */
async function realOrPlanned(path: string): Promise<string> {
	const below: string[] = [];
	let probe = resolve(path);
	for (;;) {
		try {
			return join(await realpath(probe), ...below);
		} catch (error) {
			const parent = dirname(probe);
			if (parent === probe || !isMissing(error)) throw error;
			below.unshift(basename(probe));
			probe = parent;
		}
	}
}

export async function containedPath(base: string, target: string): Promise<Contained> {
	if (!isContained(resolve(base), resolve(target))) return { problem: `${target} is outside ${base}` };
	const realBase = await realOrPlanned(base);
	const real = await realOrPlanned(target);
	if (!isContained(realBase, real)) return { problem: `${target} is a link that leads outside ${base}` };
	if (await isDanglingLink(target)) return { problem: `${target} is a link to a file that does not exist` };
	return { real };
}

async function isDanglingLink(path: string): Promise<boolean> {
	let isLink = false;
	try {
		isLink = (await lstat(path)).isSymbolicLink();
	} catch {
		return false;
	}
	if (!isLink) return false;
	return realpath(path).then(
		() => false,
		() => true,
	);
}
