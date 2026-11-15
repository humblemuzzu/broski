/**
 * File and directory search by name within a project, for `fs.search`. The tree is listed with ripgrep when
 * it is installed (it honours ignore files), else by walking it, and the listing is cached briefly.
 */

import { readdir } from "node:fs/promises";
import { dirname, join, parse as parsePath } from "node:path";
import ignore from "ignore";
import { findBinary } from "../../platform";
import { getCachedProject, setCachedProject } from "./file-search-cache";

// =============================================================================
// Types
// =============================================================================

export type FileSearchResult = string[];

export type FileSearchOptions = {
	query: string;
	cwd: string;
	limit?: number;
	includeDirs?: boolean;
};

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_SCAN_TIME_MS = 5000; // 5 seconds max for initial scan
/** A home directory holds millions of files; a listing past this many is a partial one, like a slow scan's. */
const MAX_SCANNED_FILES = 200_000;

// Files/directories to always exclude
const EXCLUDE_PATTERNS = [
	".git",
	".DS_Store",
	"node_modules",
	".next",
	".nuxt",
	"dist",
	"build",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	"venv",
	".venv",
	"env",
	".env",
	"*.pyc",
	"*.pyo",
	".idea",
	".vscode",
	"*.log",
];

// =============================================================================
// File Scanning
// =============================================================================

/**
 * Get files using ripgrep (fast, respects .gitignore)
 */
async function* scanWithRipgrep(rg: string, cwd: string): AsyncGenerator<string> {
	// Security: do not follow symlinks (prevents scanning outside the allowed base via symlink escapes).
	const proc = Bun.spawn([rg, "--files", "--hidden", "--glob=!.git/*"], {
		cwd,
		stdout: "pipe",
		stderr: "ignore",
	});

	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (line) yield line;
			}
		}

		if (buffer) yield buffer;
	} finally {
		// A scan stopped early leaves ripgrep blocked on a full pipe; it is stopped rather than waited for.
		proc.kill();
		reader.releaseLock();
		await proc.exited;
	}
}

/**
 * Get files using Bun's filesystem (fallback, slower)
 */
async function* scanWithBunFs(cwd: string, relativePath: string = ""): AsyncGenerator<string> {
	const fullPath = relativePath ? join(cwd, relativePath) : cwd;

	// Load gitignore if present
	let ig = ignore();
	try {
		const gitignorePath = join(cwd, ".gitignore");
		const gitignoreFile = Bun.file(gitignorePath);
		if (await gitignoreFile.exists()) {
			ig = ig.add(await gitignoreFile.text());
		}

		const ignorePath = join(cwd, ".ignore");
		const ignoreFile = Bun.file(ignorePath);
		if (await ignoreFile.exists()) {
			ig = ig.add(await ignoreFile.text());
		}
	} catch {
		// Ignore errors reading ignore files
	}

	// Add default excludes
	ig = ig.add(EXCLUDE_PATTERNS);

	try {
		const entries = await readdir(fullPath, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name.startsWith(".") && entry.name !== ".") continue;

			const entryRelPath = relativePath ? join(relativePath, entry.name) : entry.name;

			// Check gitignore
			if (ig.ignores(entry.isDirectory() ? `${entryRelPath}/` : entryRelPath)) {
				continue;
			}

			if (entry.isDirectory()) {
				// Recurse into directory (but skip common heavy directories)
				if (!EXCLUDE_PATTERNS.includes(entry.name)) {
					yield* scanWithBunFs(cwd, entryRelPath);
				}
			} else {
				yield entryRelPath;
			}
		}
	} catch {
		// Ignore errors reading directories
	}
}

/**
 * Scan project directory and build file/dir lists
 */
async function scanProject(cwd: string): Promise<{ files: string[]; dirs: string[] }> {
	// Check if at filesystem root (don't scan)
	const parsed = parsePath(cwd);
	if (cwd === parsed.root) {
		console.log("[file-search] Refusing to scan filesystem root");
		return { files: [], dirs: [] };
	}

	const files: string[] = [];
	const dirsSet = new Set<string>();

	const rg = findBinary("rg");
	const scanner = rg ? scanWithRipgrep(rg, cwd) : scanWithBunFs(cwd);

	const startTime = Date.now();

	for await (const file of scanner) {
		files.push(file);

		// Extract directory paths from file path
		let current = file;
		while (true) {
			const dir = dirname(current);
			if (dir === "." || dir === current) break;
			current = dir;
			if (dirsSet.has(dir)) continue;
			dirsSet.add(dir);
		}

		if (Date.now() - startTime > MAX_SCAN_TIME_MS || files.length >= MAX_SCANNED_FILES) break;
	}

	const dirs = Array.from(dirsSet).map((d) => `${d}/`);

	return { files, dirs };
}

// =============================================================================
// Fuzzy Search
// =============================================================================

/**
 * Simple fuzzy score - how well does query match target?
 * Higher score = better match
 */
function fuzzyScore(query: string, target: string): number {
	const lowerQuery = query.toLowerCase();
	const lowerTarget = target.toLowerCase();

	// Exact match at start
	if (lowerTarget.startsWith(lowerQuery)) {
		return 1000 + (100 - target.length); // Prefer shorter paths
	}

	// Exact substring match
	const idx = lowerTarget.indexOf(lowerQuery);
	if (idx !== -1) {
		// Prefer matches at word boundaries
		const isWordBoundary = idx === 0 || ["/", "_", "-", "."].includes(lowerTarget[idx - 1]!);
		return 500 + (isWordBoundary ? 100 : 0) + (100 - target.length);
	}

	// Fuzzy match - each char must appear in order
	let score = 0;
	let targetIdx = 0;
	let consecutive = 0;

	for (const char of lowerQuery) {
		const foundIdx = lowerTarget.indexOf(char, targetIdx);
		if (foundIdx === -1) return -1; // No match

		// Bonus for consecutive matches
		if (foundIdx === targetIdx) {
			consecutive++;
			score += consecutive * 2;
		} else {
			consecutive = 0;
		}

		// Bonus for matches at word boundaries
		if (foundIdx === 0 || ["/", "_", "-", "."].includes(lowerTarget[foundIdx - 1]!)) {
			score += 10;
		}

		score += 1;
		targetIdx = foundIdx + 1;
	}

	// Prefer shorter paths
	score += Math.max(0, 50 - target.length);

	return score;
}

/**
 * Sort results by fuzzy match score
 */
function sortByFuzzyScore(items: string[], query: string): string[] {
	if (!query) return items;

	const scored = items
		.map((item) => ({ item, score: fuzzyScore(query, item) }))
		.filter((x) => x.score >= 0)
		.sort((a, b) => b.score - a.score);

	return scored.map((x) => x.item);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Files and directories under `cwd` whose path relative to it matches `query`, best match first; a directory
 * ends with `/`. `cwd` is a directory that has passed the path policy.
 */
export async function searchFilesAndDirs(options: FileSearchOptions): Promise<FileSearchResult> {
	const { query, cwd } = options;
	const limit = options.limit ?? DEFAULT_LIMIT;
	let cached = getCachedProject(cwd);
	if (!cached) {
		const { files, dirs } = await scanProject(cwd);
		setCachedProject(cwd, files, dirs);
		cached = { files, dirs, fetchedAt: Date.now() };
	}
	const allItems = options.includeDirs === false ? cached.files : [...cached.files, ...cached.dirs];
	return sortByFuzzyScore(allItems, query).slice(0, limit);
}
