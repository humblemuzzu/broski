import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeFilesystemAgent } from "../../types";
import { classifySource } from "./shared";

// ── Filesystem-based Agent Discovery ─────────────────────────────────
// Scans .claude/agents/ directories (project + user) for .md agent files.
// Each .md file defines a subagent that Claude Code auto-loads at session startup.
// See: https://code.claude.com/docs/en/sub-agents

function parseAgentFile(name: string, content: string): Omit<ClaudeCodeFilesystemAgent, "source" | "path"> {
	let description: string | undefined;
	let tools: string[] | undefined;
	let model: string | undefined;
	let memory: "user" | "project" | "local" | undefined;
	let background: boolean | undefined;
	let isolation: "worktree" | undefined;

	// Parse YAML frontmatter if present
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const modelMatch = frontmatter.match(/model:\s*(.+)/);
		if (modelMatch) model = modelMatch[1]?.trim();

		const memoryMatch = frontmatter.match(/memory:\s*(.+)/);
		if (memoryMatch) {
			const scope = (memoryMatch[1] ?? "").trim().replace(/['"]/g, "") as "user" | "project" | "local";
			if (scope === "user" || scope === "project" || scope === "local") {
				memory = scope;
			}
		}

		const backgroundMatch = frontmatter.match(/background:\s*(true|false)/);
		if (backgroundMatch) {
			background = backgroundMatch[1] === "true";
		}

		const isolationMatch = frontmatter.match(/isolation:\s*(.+)/);
		if (isolationMatch) {
			const iso = (isolationMatch[1] ?? "").trim().replace(/['"]/g, "");
			if (iso === "worktree") {
				isolation = "worktree";
			}
		}

		// Tools can be comma-separated or YAML array
		const toolsMatch = frontmatter.match(/tools:\s*\[([^\]]*)\]/);
		if (toolsMatch) {
			tools = (toolsMatch[1] ?? "")
				.split(",")
				.map((t) => t.trim().replace(/["']/g, ""))
				.filter(Boolean);
		} else {
			// Check for YAML list format
			const toolsListMatch = frontmatter.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/);
			if (toolsListMatch) {
				tools = (toolsListMatch[1] ?? "")
					.split("\n")
					.map((line) => line.replace(/^\s*-\s*/, "").trim())
					.filter(Boolean);
			}
		}
	}

	// If no frontmatter description, use first non-empty line after frontmatter
	if (!description) {
		const bodyStart = frontmatterMatch ? content.indexOf("---", 4) + 3 : 0;
		const body = content.slice(bodyStart).trim();
		const firstLine = body.split("\n").find((l) => l.trim() && !l.startsWith("#"));
		if (firstLine) description = firstLine.trim().slice(0, 200);
	}

	// The full content (minus frontmatter) is the agent's prompt/instructions
	const promptStart = frontmatterMatch ? content.indexOf("---", 4) + 3 : 0;
	const prompt = content.slice(promptStart).trim();

	return {
		name,
		description,
		prompt: prompt || undefined,
		tools,
		model,
		memory,
		...(typeof background === "boolean" ? { background } : {}),
		...(isolation ? { isolation } : {}),
	};
}

export async function listAgents(cwd?: string): Promise<ClaudeCodeFilesystemAgent[]> {
	const agents: ClaudeCodeFilesystemAgent[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "agents"));
	}

	searchDirs.push(join(homedir(), ".claude", "agents"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "agents");
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

				const filePath = join(dir, entry.name);
				const name = entry.name.replace(/\.md$/, "");

				// Skip if we already have an agent with this name (project takes precedence)
				if (agents.some((a) => a.name === name)) continue;

				try {
					const content = await readFile(filePath, "utf-8");
					const parsed = parseAgentFile(name, content);
					agents.push({ ...parsed, source, path: filePath });
				} catch {
					agents.push({ name, source, path: filePath });
				}
			}
		} catch {}
	}

	return agents;
}
