import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeMemoryEntry } from "../../types";

// ---------------------------------------------------------------------------
// Memory: read from ~/.claude/memory/ (user), .claude/memory/ (project),
// and ~/.claude/memory-local/ (local).
// The SDK writes memories as individual .md files in these directories.
// ---------------------------------------------------------------------------

function classifyMemorySource(filename: string, content: string): ClaudeCodeMemoryEntry["source"] {
	const filenameLower = filename.toLowerCase();
	if (
		filenameLower.includes("auto-memory") ||
		filenameLower.includes("automemory") ||
		filenameLower.startsWith("auto-") ||
		filenameLower.includes(".auto.")
	) {
		return "auto";
	}

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = (frontmatterMatch[1] ?? "").toLowerCase();
		const normalized = frontmatter.replace(/\s+/g, " ");
		if (/(^|\s)(source|memory_source|origin|type):\s*['"]?auto['"]?(\s|$)/.test(normalized)) {
			return "auto";
		}
		if (/(^|\s)(source|memory_source|origin|type):\s*['"]?manual['"]?(\s|$)/.test(normalized)) {
			return "manual";
		}
	}

	const contentLower = content.toLowerCase();
	if (contentLower.includes("auto-memory") || contentLower.includes("generated automatically")) {
		return "auto";
	}

	return "unknown";
}

async function readMemoryDir(dir: string, scope: "user" | "project" | "local"): Promise<ClaudeCodeMemoryEntry[]> {
	const entries: ClaudeCodeMemoryEntry[] = [];
	try {
		const files = await readdir(dir, { withFileTypes: true });
		for (const file of files) {
			if (!file.isFile()) continue;
			if (file.name.startsWith(".")) continue;
			const filePath = join(dir, file.name);
			try {
				const content = await readFile(filePath, "utf-8");
				// Try to extract date from filename (e.g. "2025-02-07T12-00-00.md")
				const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
				entries.push({
					scope,
					filename: file.name,
					content: content.trim(),
					createdAt: dateMatch ? dateMatch[1] : undefined,
					path: filePath,
					source: classifyMemorySource(file.name, content),
				});
			} catch {
				// Skip unreadable files
			}
		}
	} catch {
		// Directory doesn't exist — that's fine
	}
	return entries;
}

export async function listMemories(
	scope?: "user" | "project" | "local",
	cwd?: string,
): Promise<ClaudeCodeMemoryEntry[]> {
	const results: ClaudeCodeMemoryEntry[] = [];
	const home = homedir();

	const dirs: Array<{ path: string; scope: "user" | "project" | "local" }> = [];
	if (!scope || scope === "user") {
		dirs.push({ path: join(home, ".claude", "memory"), scope: "user" });
	}
	if (!scope || scope === "project") {
		if (cwd) {
			dirs.push({ path: join(cwd, ".claude", "memory"), scope: "project" });
		}
	}
	if (!scope || scope === "local") {
		dirs.push({ path: join(home, ".claude", "memory-local"), scope: "local" });
	}

	for (const { path, scope: s } of dirs) {
		const memories = await readMemoryDir(path, s);
		results.push(...memories);
	}

	// Sort newest first
	results.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
	return results;
}

export async function deleteMemory(
	scope: "user" | "project" | "local",
	filename: string,
	cwd?: string,
): Promise<boolean> {
	const home = homedir();
	let dir: string;
	switch (scope) {
		case "user":
			dir = join(home, ".claude", "memory");
			break;
		case "project":
			if (!cwd) return false;
			dir = join(cwd, ".claude", "memory");
			break;
		case "local":
			dir = join(home, ".claude", "memory-local");
			break;
	}

	const filePath = join(dir, filename);
	// Security: ensure the resolved path is inside the expected directory
	const { realpath } = await import("fs/promises");
	try {
		const resolvedDir = await realpath(dir);
		const resolvedFile = await realpath(filePath);
		if (!resolvedFile.startsWith(resolvedDir)) return false;
	} catch {
		return false;
	}

	try {
		await (await import("fs/promises")).unlink(filePath);
		return true;
	} catch {
		return false;
	}
}
