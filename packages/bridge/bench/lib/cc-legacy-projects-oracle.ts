/**
 * The pre-optimisation project listing: source 1 plus an uncached recursive walk, and the lossy
 * directory-name decoder that backs it. Kept so parity tests and the real-data benchmark can diff
 * new against old.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectSummary } from "../../src/types";
import { legacyReadSessionPreview } from "./cc-legacy-oracle";

export async function legacyListProjects(projectsDir: string, home: string, maxDepth = 5): Promise<ProjectSummary[]> {
	const seenPaths = new Set<string>();
	const projects: ProjectSummary[] = [];

	try {
		const entries = await readdir(projectsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const dirPath = join(projectsDir, entry.name);
			const dirSt = await stat(dirPath).catch(() => null);

			let latestFile: { path: string; mtime: number } | null = null;
			try {
				const files = await readdir(dirPath);
				for (const f of files) {
					if (!f.endsWith(".jsonl")) continue;
					const fp = join(dirPath, f);
					const st = await stat(fp).catch(() => null);
					if (!st) continue;
					const mtime = st.mtime.getTime();
					if (!latestFile || mtime > latestFile.mtime) {
						latestFile = { path: fp, mtime };
					}
				}
			} catch {
				// ignore
			}

			const preview = latestFile ? await legacyReadSessionPreview(latestFile.path) : {};
			let cwd = preview.cwd;

			if (!cwd) {
				cwd = (await legacyDecodeProjectDirName(entry.name)) ?? undefined;
			}

			if (!cwd) continue;
			if (seenPaths.has(cwd)) continue;
			seenPaths.add(cwd);

			projects.push({
				id: cwd,
				name: basename(cwd) || cwd,
				path: cwd,
				lastOpened: latestFile?.mtime ?? dirSt?.mtime?.getTime(),
			});
		}
	} catch {
		// ignore – projects dir may not exist yet
	}

	const scanRoots = [
		join(home, "Documents"),
		join(home, "StudioProjects"),
		join(home, "Desktop"),
		join(home, "Projects"),
		join(home, "Developer"),
		join(home, "repos"),
		join(home, "src"),
		join(home, "code"),
		join(home, "Code"),
		join(home, "workspace"),
		join(home, "dev"),
	];

	for (const root of scanRoots) {
		try {
			await legacyDiscoverClaudeProjects(root, 0, maxDepth, seenPaths, projects);
		} catch {
			// root doesn't exist or isn't readable – skip
		}
	}

	projects.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
	return projects;
}

async function legacyExistsDir(path: string): Promise<boolean> {
	try {
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

async function legacyDecodeProjectDirName(dirName: string): Promise<string | null> {
	if (!dirName.startsWith("-")) return null;
	const rest = dirName.slice(1);
	if (!rest) return "/";

	const segments = rest.split("-");
	if (segments.length === 0) return null;

	async function resolve(idx: number, current: string): Promise<string | null> {
		if (idx >= segments.length) {
			return (await legacyExistsDir(current)) ? current : null;
		}

		for (let end = segments.length; end > idx; end--) {
			const component = segments.slice(idx, end).join(" ");
			const candidateSep = `${current}/${component}`;
			if (await legacyExistsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		for (let end = segments.length; end > idx + 1; end--) {
			const component = segments.slice(idx, end).join("-");
			const candidateSep = `${current}/${component}`;
			if (await legacyExistsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		return null;
	}

	return resolve(0, "");
}

async function legacyDiscoverClaudeProjects(
	dir: string,
	depth: number,
	maxDepth: number,
	seen: Set<string>,
	out: ProjectSummary[],
): Promise<void> {
	if (depth > maxDepth) return;

	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	const dirBase = basename(dir);
	if (["node_modules", ".git", ".svn", "build", "dist", ".cache", ".Trash"].includes(dirBase)) return;

	const hasClaudeDir = entries.some((e) => e.isDirectory() && e.name === ".claude");
	if (hasClaudeDir && !seen.has(dir)) {
		const claudeDir = join(dir, ".claude");
		const isRealProject = await Promise.all([
			stat(join(claudeDir, "settings.local.json")).catch(() => null),
			stat(join(claudeDir, "settings.json")).catch(() => null),
		]).then(([a, b]) => a || b);

		if (isRealProject) {
			seen.add(dir);
			const claudeSt = await stat(claudeDir).catch(() => null);
			out.push({
				id: dir,
				name: basename(dir),
				path: dir,
				lastOpened: claudeSt?.mtime?.getTime(),
			});
		}
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
		if (["node_modules", ".git", ".svn", "build", "dist", ".cache", ".Trash"].includes(entry.name)) continue;
		await legacyDiscoverClaudeProjects(join(dir, entry.name), depth + 1, maxDepth, seen, out);
	}
}
