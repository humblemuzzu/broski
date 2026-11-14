/**
 * Project-scoped file and directory search, for `@` autocomplete.
 * Uses Bun's native filesystem APIs
 * with ripgrep for performance (falls back to Bun glob if rg not available).
 */

import { realpathSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse as parsePath, sep } from "node:path";
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

/** Searching is allowed within the home and the OS temp directory, compared as real paths (macOS's temp is a link). */
const ALLOWED_BASE_PATHS = [homedir(), tmpdir()].map((base) => {
	try {
		return realpathSync(base);
	} catch {
		return base;
	}
});

// =============================================================================
// Security
// =============================================================================

async function isPathAllowed(requestedPath: string): Promise<boolean> {
	try {
		if (!requestedPath || typeof requestedPath !== "string") return false;
		if (requestedPath.length > 4096) return false;
		if (requestedPath.includes("\0")) return false;
		if (/[\u0000-\u001F]/.test(requestedPath)) return false;

		const expandedPath = requestedPath.startsWith("~") ? requestedPath.replace(/^~/, homedir()) : requestedPath;

		const realPath = await realpath(expandedPath).catch(() => null);
		if (!realPath) return false;

		return ALLOWED_BASE_PATHS.some((base) => realPath === base || realPath.startsWith(base + sep));
	} catch {
		return false;
	}
}

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

		// Prevent scanning for too long
		if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
			console.log(`[file-search] Scan timeout after ${MAX_SCAN_TIME_MS}ms, returning partial results`);
			break;
		}
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
 * Search for files and directories in a project
 *
 * @param options Search options
 * @returns Array of matching file/directory paths (relative to cwd)
 */
export async function searchFilesAndDirs(options: FileSearchOptions): Promise<FileSearchResult> {
	const rawQuery = typeof options.query === "string" ? options.query : "";
	const query = rawQuery.length > 256 ? rawQuery.slice(0, 256) : rawQuery;
	const cwd = options.cwd;
	const limit = Math.max(1, Math.min(Number(options.limit ?? DEFAULT_LIMIT), 200));
	const includeDirs = options.includeDirs !== false;

	// Security check
	if (!cwd || !(await isPathAllowed(cwd))) {
		console.error(`[file-search] Access denied or invalid path: ${cwd}`);
		return [];
	}

	// Expand ~ if present
	const expandedCwd = cwd.startsWith("~") ? cwd.replace(/^~/, homedir()) : cwd;

	// Check if directory exists
	try {
		const stats = await stat(expandedCwd);
		if (!stats.isDirectory()) {
			console.error(`[file-search] Not a directory: ${expandedCwd}`);
			return [];
		}
	} catch {
		console.error(`[file-search] Directory not found: ${expandedCwd}`);
		return [];
	}

	// Try cache first
	let cached = getCachedProject(expandedCwd);

	if (!cached) {
		// Scan project (this happens in background after first request)
		const { files, dirs } = await scanProject(expandedCwd);
		setCachedProject(expandedCwd, files, dirs);
		cached = { files, dirs, fetchedAt: Date.now() };

		// Trigger background refresh for next time
		setTimeout(() => {
			scanProject(expandedCwd)
				.then(({ files, dirs }) => {
					setCachedProject(expandedCwd, files, dirs);
				})
				.catch(() => {});
		}, 100);
	}

	// Combine files and dirs based on option
	const allItems = includeDirs ? [...cached.files, ...cached.dirs] : cached.files;

	// If no query, return sorted dirs first then files
	if (!query) {
		const sorted = includeDirs
			? [...cached.dirs.sort(), ...cached.files.slice(0, limit - cached.dirs.length)]
			: cached.files.slice(0, limit);
		return sorted.slice(0, limit);
	}

	// Fuzzy search
	const results = sortByFuzzyScore(allItems, query);

	return results.slice(0, limit);
}
