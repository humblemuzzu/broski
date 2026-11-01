/** The files that already exist in a directory kind: agents, commands, skills, output styles, auto memory notes. */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigPlace } from "./config-paths";

const MAX_MEMBERS = 300;
const MAX_DEPTH = 3;
const MAX_VISITED = 5_000;
const SKIPPED = new Set(["node_modules"]);

export interface Members {
	readonly relatives: string[];
	readonly omitted: number;
}

interface Budget {
	left: number;
}

function isFileLike(entry: Dirent): boolean {
	return entry.isFile() || entry.isSymbolicLink();
}

async function entriesOf(directory: string, budget: Budget): Promise<Dirent[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	const kept = entries.filter((entry) => !entry.name.startsWith(".") && !SKIPPED.has(entry.name));
	budget.left -= kept.length;
	return kept;
}

async function skillFiles(directory: string, budget: Budget): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await entriesOf(directory, budget)) {
		if (budget.left < 0) break;
		if (!entry.isDirectory()) continue;
		const inside = await entriesOf(join(directory, entry.name), budget);
		if (inside.some((file) => file.name === "SKILL.md" && isFileLike(file))) found.push(`${entry.name}/SKILL.md`);
	}
	return found;
}

async function markdownFiles(directory: string, prefix: string, depth: number, budget: Budget): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await entriesOf(join(directory, prefix), budget)) {
		if (budget.left < 0) break;
		const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory() && depth < MAX_DEPTH)
			found.push(...(await markdownFiles(directory, rel, depth + 1, budget)));
		else if (isFileLike(entry) && entry.name.endsWith(".md")) found.push(rel);
	}
	return found;
}

/** The relative paths of what exists below a template's directory, sorted and bounded. */
export async function listMembers(template: ConfigPlace): Promise<Members> {
	const budget: Budget = { left: MAX_VISITED };
	const all =
		template.kind === "skills"
			? await skillFiles(template.path, budget)
			: await markdownFiles(template.path, "", 0, budget);
	all.sort();
	return { relatives: all.slice(0, MAX_MEMBERS), omitted: Math.max(0, all.length - MAX_MEMBERS) };
}
