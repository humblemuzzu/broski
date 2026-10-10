import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { ClaudeCodeCommand } from "../../types";
import { classifySource } from "./shared";

async function scanCommandsRecursive(
	baseDir: string,
	currentDir: string,
	source: "project" | "user",
	out: ClaudeCodeCommand[],
): Promise<void> {
	try {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			const fullPath = join(currentDir, entry.name);

			if (entry.isDirectory()) {
				await scanCommandsRecursive(baseDir, fullPath, source, out);
				continue;
			}

			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

			const rel = relative(baseDir, fullPath);
			const withoutExt = rel.replace(/\.md$/, "");
			const name = withoutExt.replace(/[\\/]/g, ":");

			try {
				const content = await readFile(fullPath, "utf-8");
				const cmd = parseCommandFile(name, content);
				out.push({ ...cmd, source, path: fullPath });
			} catch {
				out.push({ name, source, path: fullPath });
			}
		}
	} catch {
		// ignore (dir doesn't exist)
	}
}

export async function listCommands(cwd?: string): Promise<ClaudeCodeCommand[]> {
	const commands: ClaudeCodeCommand[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "commands"));
	}

	searchDirs.push(join(homedir(), ".claude", "commands"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "commands");
		await scanCommandsRecursive(dir, dir, source, commands);
	}

	// Also include commands exposed by enabled plugins (so "/" autocomplete finds them).
	try {
		const pluginsModule = await import("../../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const pluginCommands = Array.isArray(plugin.commands) ? plugin.commands : [];
			if (pluginCommands.length === 0) continue;

			for (const name of pluginCommands) {
				// Prefer explicit .claude/commands definitions if present.
				if (commands.some((c) => c.name === name)) continue;

				const filePath = join(plugin.path, "commands", `${name}.md`);
				try {
					const content = await readFile(filePath, "utf-8");
					commands.push({ ...parseCommandFile(name, content), source: "plugin", path: filePath });
				} catch {
					commands.push({ name, source: "plugin", path: filePath });
				}
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return commands;
}

function parseCommandFile(name: string, content: string): ClaudeCodeCommand {
	let description: string | undefined;
	let agent: string | undefined;
	let model: string | undefined;
	let subtask = false;

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const agentMatch = frontmatter.match(/agent:\s*(.+)/);
		if (agentMatch) agent = agentMatch[1]?.trim();

		const modelMatch = frontmatter.match(/model:\s*(.+)/);
		if (modelMatch) model = modelMatch[1]?.trim();

		const subtaskMatch = frontmatter.match(/subtask:\s*(true|false)/);
		if (subtaskMatch) subtask = subtaskMatch[1] === "true";
	}

	return { name, description, agent, model, subtask };
}
