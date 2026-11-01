import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export type SkillSource = "project" | "user" | "system" | "admin" | "plugin";

export type SkillListEntry = {
	name: string;
	description?: string;
	path: string;
	source: SkillSource;
	editable: boolean;
};

const SKILL_FILENAME = "SKILL.md";
const SKILL_NAME_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validateSkillName(name: string): boolean {
	const normalized = name.trim();
	if (normalized.length < 1 || normalized.length > 256) return false;
	if (normalized.includes("\0")) return false;
	if (normalized.startsWith("/")) return false;
	if (normalized.includes("\\")) return false;

	const parts = normalized.split("/");
	if (parts.some((p) => !p || p === "." || p === ".." || !SKILL_NAME_SEGMENT_RE.test(p))) {
		return false;
	}
	return true;
}

function parseDescriptionFromFrontmatter(content: string): string | undefined {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) return;
	const frontmatter = frontmatterMatch[1]!;
	const descMatch = frontmatter.match(/(?:^|\n)description:\s*(.+)\s*$/m);
	return descMatch?.[1]?.trim() || undefined;
}

async function listSkillsInRoot(rootDir: string, source: SkillSource): Promise<SkillListEntry[]> {
	const out: SkillListEntry[] = [];
	try {
		const rootAbs = resolve(rootDir);

		const visit = async (dir: string) => {
			let entries: import("node:fs").Dirent[];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}

			for (const entry of entries) {
				// Skip hidden directories to avoid picking up unexpected internal folders.
				if (entry.isDirectory() && entry.name.startsWith(".")) continue;

				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					await visit(full);
					continue;
				}

				if (!entry.isFile()) continue;
				if (entry.name !== SKILL_FILENAME) continue;

				const skillDir = dirname(full);
				const relDir = relative(rootAbs, skillDir);
				if (!relDir || relDir.startsWith("..")) continue;

				const name = relDir.split(/[\\/]/).join("/");
				if (!validateSkillName(name)) continue;

				try {
					const content = await readFile(full, "utf-8");
					out.push({
						name,
						description: parseDescriptionFromFrontmatter(content),
						path: full,
						source,
						editable: source === "project" || source === "user",
					});
				} catch {
					out.push({
						name,
						path: full,
						source,
						editable: source === "project" || source === "user",
					});
				}
			}
		};

		await visit(rootAbs);
	} catch {
		// ignore
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

// ============================================================================
// Claude Code Skills (.claude/skills + ~/.claude/skills)
// ============================================================================

export function getClaudeCodeSkillFilePath(params: {
	name: string;
	source: Extract<SkillSource, "project" | "user">;
	cwd?: string;
}): string {
	const { name, source } = params;
	const cwd = params.cwd || process.cwd();
	const base = source === "project" ? join(cwd, ".claude", "skills", name) : join(homedir(), ".claude", "skills", name);
	return join(base, SKILL_FILENAME);
}

export async function listClaudeCodeSkills(cwd?: string): Promise<SkillListEntry[]> {
	const projectRoot = join(cwd || process.cwd(), ".claude", "skills");
	const userRoot = join(homedir(), ".claude", "skills");
	const [project, user] = await Promise.all([
		listSkillsInRoot(projectRoot, "project"),
		listSkillsInRoot(userRoot, "user"),
	]);
	return [...project, ...user];
}

export async function readSkillFile(skillPath: string): Promise<string> {
	return await readFile(skillPath, "utf-8");
}

export async function writeSkillFile(skillPath: string, content: string): Promise<void> {
	const dir = resolve(skillPath, "..");
	await mkdir(dir, { recursive: true });
	await writeFile(skillPath, content, "utf-8");
}

export async function deleteSkillByPath(skillPath: string): Promise<void> {
	const dir = resolve(skillPath, "..");
	await rm(dir, { recursive: true, force: true });
}
