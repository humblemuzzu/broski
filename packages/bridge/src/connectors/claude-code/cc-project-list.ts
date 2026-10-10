/**
 * Claude Code project listing.
 *
 * Two sources, as before: the central `~/.claude/projects` store and a recursive scan of the
 * usual places a repo lives. Source 1 is re-read each call through the fingerprint-cached preview
 * reader; source 2 (the expensive walk) is served from `cc-project-discovery`'s TTL cache.
 */

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectSummary } from "../../types";
import { singleFlight } from "../../utils/single-flight";
import { decodeProjectDirName } from "./cc-paths";
import { discoverClaudeProjectsCached } from "./cc-project-discovery";
import { readSessionPreviewCached } from "./cc-session-preview";

export type CcProjectListOptions = {
	projectsDir: string;
	home: string;
	maxDepth?: number;
};

export const CC_PROJECT_SCAN_MAX_DEPTH = 5;

const HOME_SCAN_SUBDIRS = [
	"Documents",
	"StudioProjects",
	"Desktop",
	"Projects",
	"Developer",
	"repos",
	"src",
	"code",
	"Code",
	"workspace",
	"dev",
];

const listInFlight = new Map<string, Promise<ProjectSummary[]>>();

export function listProjectsFromClaudeDirs(options: CcProjectListOptions): Promise<ProjectSummary[]> {
	const { projectsDir, home, maxDepth = CC_PROJECT_SCAN_MAX_DEPTH } = options;
	return singleFlight(listInFlight, `${projectsDir}\u0000${home}`, () => collectProjects(projectsDir, home, maxDepth));
}

async function collectProjects(projectsDir: string, home: string, maxDepth: number): Promise<ProjectSummary[]> {
	const seenPaths = new Set<string>();
	const projects: ProjectSummary[] = [];

	await collectStoredProjects(projectsDir, seenPaths, projects);

	const scanRoots = HOME_SCAN_SUBDIRS.map((name) => join(home, name));
	const discovered = await discoverClaudeProjectsCached(scanRoots, maxDepth);
	for (const project of discovered) {
		if (seenPaths.has(project.id)) continue;
		seenPaths.add(project.id);
		projects.push(project);
	}

	projects.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
	return projects;
}

async function latestSessionFile(dirPath: string): Promise<{ path: string; mtime: number } | null> {
	let latest: { path: string; mtime: number } | null = null;
	try {
		for (const name of await readdir(dirPath)) {
			if (!name.endsWith(".jsonl")) continue;
			const path = join(dirPath, name);
			const info = await stat(path).catch(() => null);
			if (!info) continue;
			const mtime = info.mtime.getTime();
			if (!latest || mtime > latest.mtime) latest = { path, mtime };
		}
	} catch {
		// ignore
	}
	return latest;
}

async function storedProjectFor(entry: Dirent, projectsDir: string): Promise<ProjectSummary | null> {
	const dirPath = join(projectsDir, entry.name);
	const dirStat = await stat(dirPath).catch(() => null);
	const latestFile = await latestSessionFile(dirPath);

	// Best-effort: the newest session file carries the cwd; otherwise decode the directory name.
	const preview = latestFile ? await readSessionPreviewCached(latestFile.path) : {};
	const cwd = preview.cwd ?? (await decodeProjectDirName(entry.name)) ?? undefined;
	if (!cwd) return null;

	return {
		id: cwd,
		name: basename(cwd) || cwd,
		path: cwd,
		lastOpened: latestFile?.mtime ?? dirStat?.mtime?.getTime(),
	};
}

async function collectStoredProjects(
	projectsDir: string,
	seenPaths: Set<string>,
	projects: ProjectSummary[],
): Promise<void> {
	try {
		const entries = await readdir(projectsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const project = await storedProjectFor(entry, projectsDir);
			if (!project) continue;
			if (seenPaths.has(project.id)) continue;
			seenPaths.add(project.id);
			projects.push(project);
		}
	} catch {
		// ignore – projects dir may not exist yet
	}
}
