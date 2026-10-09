import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import ignore from "ignore";

type IgnoreRules = ReturnType<typeof ignore>;
type IgnoreLayer = { dir: string; rules: IgnoreRules };

export type FileWalkOptions = {
	ignore?: readonly string[];
	/** Returning false stops the walk. */
	onFile(absolutePath: string, relativePath: string): boolean | Promise<boolean>;
};

const NEVER_WALKED = new Set([".git"]);

export function toPosixPath(value: string): string {
	return value.split(sep).join("/");
}

export async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

async function sortedEntries(dir: string): Promise<Dirent[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	} catch {
		return [];
	}
}

async function gitignoreRules(dir: string): Promise<IgnoreRules | undefined> {
	let source: string;
	try {
		source = await readFile(join(dir, ".gitignore"), "utf8");
	} catch {
		return undefined;
	}
	return ignore().add(source);
}

/** The repository's `.gitignore` files above the search root, outermost first, as ripgrep reads them. */
async function ancestorLayers(root: string): Promise<IgnoreLayer[]> {
	const repository = await repositoryRoot(root);
	if (repository === undefined || repository === root) return [];
	const collected: IgnoreLayer[] = [];
	for (let dir = dirname(root); ; ) {
		const rules = await gitignoreRules(dir);
		if (rules !== undefined) collected.push({ dir, rules });
		if (dir === repository) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return collected.reverse();
}

async function repositoryRoot(root: string): Promise<string | undefined> {
	for (let dir = root; ; ) {
		if (await pathExists(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export async function walkFiles(root: string, options: FileWalkOptions): Promise<void> {
	const requested = ignore().add(options.ignore ?? []);
	const layers: IgnoreLayer[] = await ancestorLayers(root);

	const isIgnored = (absolutePath: string, directory: boolean): boolean => {
		const fromRoot = toPosixPath(relative(root, absolutePath));
		if (fromRoot === "") return false;
		if (requested.ignores(directory ? `${fromRoot}/` : fromRoot)) return true;
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const layer = layers[index];
			if (layer === undefined) continue;
			const local = toPosixPath(relative(layer.dir, absolutePath));
			if (local === "" || local.startsWith("..")) continue;
			const verdict = layer.rules.test(directory ? `${local}/` : local);
			if (verdict.ignored) return true;
			if (verdict.unignored) return false;
		}
		return false;
	};

	const walk = async (dir: string): Promise<boolean> => {
		const rules = await gitignoreRules(dir);
		if (rules !== undefined) layers.push({ dir, rules });
		try {
			for (const entry of await sortedEntries(dir)) {
				if (NEVER_WALKED.has(entry.name)) continue;
				const absolutePath = join(dir, entry.name);
				const directory = entry.isDirectory();
				if (!directory && !entry.isFile()) continue;
				if (isIgnored(absolutePath, directory)) continue;
				if (directory) {
					if (!(await walk(absolutePath))) return false;
					continue;
				}
				if (!(await options.onFile(absolutePath, toPosixPath(relative(root, absolutePath))))) return false;
			}
			return true;
		} finally {
			if (rules !== undefined) layers.pop();
		}
	};

	await walk(root);
}
