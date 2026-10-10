import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeCodeSkill } from "../../types";
import { classifySource } from "./shared";

export async function listSkills(cwd?: string): Promise<ClaudeCodeSkill[]> {
	const skills: ClaudeCodeSkill[] = [];
	const searchDirs: string[] = [];

	if (cwd) {
		searchDirs.push(join(cwd, ".claude", "skills"));
	}

	searchDirs.push(join(homedir(), ".claude", "skills"));

	for (const dir of searchDirs) {
		const source = classifySource(dir, "skills");
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;

				const skillPath = join(dir, entry.name, "SKILL.md");
				try {
					const content = await readFile(skillPath, "utf-8");
					const skill = parseSkillFile(entry.name, content);
					if (skill) {
						skills.push({ ...skill, source, path: skillPath });
					}
				} catch {
					skills.push({
						name: entry.name,
						autoInvoke: false,
						source,
						path: skillPath,
					});
				}
			}
		} catch {}
	}

	// Also include skills exposed by enabled plugins.
	try {
		const pluginsModule = await import("../../plugins");
		const plugins = await pluginsModule.discoverPlugins(cwd);
		for (const plugin of plugins) {
			if (plugin.status !== "enabled") continue;
			const pluginSkills = Array.isArray(plugin.skills) ? plugin.skills : [];
			if (pluginSkills.length === 0) continue;

			for (const name of pluginSkills) {
				// Prefer explicit .claude/skills definitions if present.
				if (skills.some((s) => s.name === name)) continue;

				const skillPath = join(plugin.path, "skills", name, "SKILL.md");
				try {
					const content = await readFile(skillPath, "utf-8");
					const skill = parseSkillFile(name, content);
					skills.push({ ...skill, source: "plugin", path: skillPath });
				} catch {
					skills.push({ name, autoInvoke: false, source: "plugin", path: skillPath });
				}
			}
		}
	} catch {
		// ignore (plugins optional)
	}

	return skills;
}

function parseSkillFile(name: string, content: string): ClaudeCodeSkill {
	let description: string | undefined;
	let autoInvoke = false;
	const tags: string[] = [];

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";

		const descMatch = frontmatter.match(/description:\s*(.+)/);
		if (descMatch) description = descMatch[1]?.trim();

		const autoMatch = frontmatter.match(/auto-invoke:\s*(true|false)/);
		if (autoMatch) autoInvoke = autoMatch[1] === "true";

		const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]+)\]/);
		if (tagsMatch) {
			tags.push(...(tagsMatch[1] ?? "").split(",").map((t) => t.trim().replace(/['"]/g, "")));
		}
	}

	let agent: string | undefined;
	let context: "fork" | undefined;

	if (frontmatterMatch) {
		const frontmatter = frontmatterMatch[1] ?? "";
		const agentMatch = frontmatter.match(/agent:\s*(.+)/);
		if (agentMatch) agent = agentMatch[1]?.trim();

		const contextMatch = frontmatter.match(/context:\s*(.+)/);
		if (contextMatch && contextMatch[1]?.trim() === "fork") context = "fork";
	}

	return { name, description, autoInvoke, tags: tags.length > 0 ? tags : undefined, agent, context };
}
