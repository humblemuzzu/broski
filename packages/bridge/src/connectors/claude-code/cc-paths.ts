/**
 * Claude Code session file locations.
 *
 * Extracted from claude-code.ts (frozen file) so the session listing, project listing and
 * transcript readers can resolve paths without importing the connector itself.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Claude Code stores per-project sessions under `~/.claude/projects/<projectKey>/`.
 * On macOS/Linux this is typically the absolute path with separators replaced by `-`,
 * e.g. `/Users/me/repo` -> `-Users-me-repo`.
 *
 * This encoding is not strictly reversible (paths can contain `-`), so we treat it
 * as a best-effort hint and fall back to scanning.
 */
export function encodeProjectPath(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	return normalized.replaceAll("/", "-").replaceAll(" ", "-");
}

export async function existsDir(path: string): Promise<boolean> {
	try {
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

export async function getProjectSessionsDir(cwd: string, projectsDir: string = CLAUDE_PROJECTS_DIR): Promise<string> {
	const encoded = encodeProjectPath(cwd);
	const direct = join(projectsDir, encoded);
	if (await existsDir(direct)) return direct;

	// Fallback: scan and pick the directory with a name suffix match to reduce collisions.
	// Match both the space-aware encoding AND any trailing segment.
	const base = encoded.replaceAll(/^-+/, "");
	try {
		const entries = await readdir(projectsDir, { withFileTypes: true });
		const candidates = entries
			.filter((e) => e.isDirectory())
			.map((e) => join(projectsDir, e.name))
			.filter((p) => {
				const name = basename(p);
				// Direct suffix match
				if (name.endsWith(base)) return true;
				// Normalize both sides: collapse spaces and dashes for comparison
				const normName = name.toLowerCase();
				const normBase = base.toLowerCase();
				return normName.endsWith(normBase);
			});
		if (candidates.length > 0) return candidates[0] ?? direct;
	} catch {
		// ignore
	}

	return direct;
}

/**
 * Reverse-decode a project directory name back to a real filesystem path.
 *
 * The encoding replaces both `/` and ` ` with `-`, making it lossy.
 * We reconstruct the path greedily: starting from `/`, at each `-` boundary
 * we try treating it as a directory separator first, then as a space, then as
 * a literal dash.  We pick the interpretation where the directory actually
 * exists on disk.  If nothing matches, we give up and return null.
 */
export async function decodeProjectDirName(dirName: string): Promise<string | null> {
	// Strip the leading dash that represents the root `/`
	if (!dirName.startsWith("-")) return null;
	const rest = dirName.slice(1);
	if (!rest) return "/";

	const segments = rest.split("-");
	if (segments.length === 0) return null;

	async function resolve(idx: number, current: string): Promise<string | null> {
		if (idx >= segments.length) {
			return (await existsDir(current)) ? current : null;
		}

		for (let end = segments.length; end > idx; end--) {
			const component = segments.slice(idx, end).join(" ");
			const candidateSep = `${current}/${component}`;
			if (await existsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		for (let end = segments.length; end > idx + 1; end--) {
			const component = segments.slice(idx, end).join("-");
			const candidateSep = `${current}/${component}`;
			if (await existsDir(candidateSep)) {
				if (end >= segments.length) return candidateSep;
				const deeper = await resolve(end, candidateSep);
				if (deeper) return deeper;
			}
		}

		return null;
	}

	return resolve(0, "");
}

export async function findSessionFile(
	sessionId: string,
	cwd?: string,
	projectsDir: string = CLAUDE_PROJECTS_DIR,
): Promise<string | null> {
	const filename = `${sessionId}.jsonl`;

	if (cwd) {
		const projectDir = await getProjectSessionsDir(cwd, projectsDir);
		const candidate = join(projectDir, filename);
		try {
			await stat(candidate);
			return candidate;
		} catch {
			// fall back to scan
		}
	}

	try {
		const entries = await readdir(projectsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const candidate = join(projectsDir, entry.name, filename);
			try {
				await stat(candidate);
				return candidate;
			} catch {}
		}
	} catch {
		// ignore
	}

	return null;
}
