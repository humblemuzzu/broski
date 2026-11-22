import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fnv1a } from "./types";

export interface ResolvedProject {
	readonly id: string;
	readonly name: string;
	readonly root: string;
}

/**
 * Resolves a working directory to its canonical project identity without spawning `git`.
 * Folds worktrees into their main repository via `.git` `gitdir:` pointers and normalizes
 * duplicate folder names when multiple repos share a remote origin.
 */
export class ProjectResolver {
	private readonly memo = new Map<string, ResolvedProject>();

	resolve(cwd: string): ResolvedProject {
		const cleaned = cwd.trim();
		if (!cleaned) return { id: "unknown", name: "Unknown", root: "" };
		const hit = this.memo.get(cleaned);
		if (hit) return hit;
		const resolved = computeProject(cleaned);
		this.memo.set(cleaned, resolved);
		return resolved;
	}
}

function computeProject(cwd: string): ResolvedProject {
	const gitRoot = findGitRoot(cwd);
	if (!gitRoot) {
		const name = basename(cwd) || cwd;
		return { id: `dir:${fnv1a(cwd)}`, name, root: cwd };
	}
	const commonDir = resolveGitCommonDir(gitRoot);
	const origin = commonDir ? readOriginUrl(commonDir) : undefined;
	if (origin) {
		const repoName = repoNameFromOrigin(origin) || basename(gitRoot);
		return { id: `git:${fnv1a(origin)}`, name: repoName, root: gitRoot };
	}
	const canonicalRoot = commonDir && basename(commonDir) === ".git" ? dirname(commonDir) : gitRoot;
	const name = basename(canonicalRoot) || canonicalRoot;
	return { id: `root:${fnv1a(canonicalRoot)}`, name, root: canonicalRoot };
}

function findGitRoot(start: string): string | undefined {
	let current = resolve(start);
	for (let depth = 0; depth < 24; depth++) {
		const dotGit = join(current, ".git");
		if (existsSync(dotGit)) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return undefined;
}

function resolveGitCommonDir(repoRoot: string): string | undefined {
	const dotGit = join(repoRoot, ".git");
	try {
		const st = statSync(dotGit);
		if (st.isDirectory()) return dotGit;
		if (!st.isFile()) return undefined;
		const text = readFileSync(dotGit, "utf8");
		const match = /^gitdir:\s*(.+)$/m.exec(text);
		if (!match?.[1]) return undefined;
		const gitDir = resolve(repoRoot, match[1].trim());
		const commondirFile = join(gitDir, "commondir");
		if (existsSync(commondirFile)) {
			const rel = readFileSync(commondirFile, "utf8").trim();
			if (rel) return resolve(gitDir, rel);
		}
		return gitDir;
	} catch {
		return undefined;
	}
}

function readOriginUrl(gitCommonDir: string): string | undefined {
	try {
		const config = readFileSync(join(gitCommonDir, "config"), "utf8");
		const section = /\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/.exec(config)?.[1];
		if (!section) return undefined;
		const url = /^\s*url\s*=\s*(.+)$/m.exec(section)?.[1]?.trim();
		return url ? normalizeOrigin(url) : undefined;
	} catch {
		return undefined;
	}
}

function normalizeOrigin(url: string): string {
	return url
		.replace(/\.git$/i, "")
		.replace(/^git@([^:]+):/, "https://$1/")
		.replace(/^ssh:\/\/git@([^/]+)\//, "https://$1/")
		.toLowerCase();
}

function repoNameFromOrigin(normalizedOrigin: string): string | undefined {
	const clean = normalizedOrigin.replace(/\/+$/, "");
	const slash = clean.lastIndexOf("/");
	const name = slash >= 0 ? clean.slice(slash + 1) : clean;
	return name || undefined;
}
