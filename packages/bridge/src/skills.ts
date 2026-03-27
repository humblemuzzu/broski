import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
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
// OpenCode Skills (.opencode/skill + ~/.config/opencode/skill)
// ============================================================================

export function getOpenCodeSkillFilePath(params: {
	name: string;
	source: Extract<SkillSource, "project" | "user">;
	cwd?: string;
}): string {
	const { name, source } = params;
	const cwd = params.cwd || process.cwd();
	const base =
		source === "project"
			? join(cwd, ".opencode", "skill", name)
			: join(homedir(), ".config", "opencode", "skill", name);
	return join(base, SKILL_FILENAME);
}

export async function resolveOpenCodeSkillFilePath(params: {
	name: string;
	source: Extract<SkillSource, "project" | "user">;
	cwd?: string;
}): Promise<string> {
	const { name, source } = params;
	const cwd = params.cwd || process.cwd();
	const root = source === "project" ? join(cwd, ".opencode") : join(homedir(), ".config", "opencode");

	const candidates = [join(root, "skills", name, SKILL_FILENAME), join(root, "skill", name, SKILL_FILENAME)];

	for (const candidate of candidates) {
		if (await fileExists(candidate)) return candidate;
	}

	// Default for new skills: keep legacy `.opencode/skill/<name>/SKILL.md` structure.
	return join(root, "skill", name, SKILL_FILENAME);
}

export async function listOpenCodeSkills(cwd?: string): Promise<SkillListEntry[]> {
	const userRoots = [join(homedir(), ".config", "opencode", "skill"), join(homedir(), ".config", "opencode", "skills")];
	const user = (await Promise.all(userRoots.map((r) => listSkillsInRoot(r, "user")))).flat();

	if (!cwd) return user;

	const projectRoots = [join(cwd, ".opencode", "skill"), join(cwd, ".opencode", "skills")];
	const project = (await Promise.all(projectRoots.map((r) => listSkillsInRoot(r, "project")))).flat();

	return [...project, ...user];
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

// ============================================================================
// Codex Skills (.codex/skills + $CODEX_HOME/skills + system/admin)
// ============================================================================

export type CodexSkillScope = "Repo" | "User" | "System" | "Admin";

export function codexHomeDir(): string {
	return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export function getCodexSkillFilePath(params: { name: string; scope: CodexSkillScope; cwd?: string }): string {
	const { name, scope } = params;
	const cwd = params.cwd || process.cwd();
	const codexHome = codexHomeDir();
	const root =
		scope === "Repo"
			? join(cwd, ".codex", "skills", name)
			: scope === "User"
				? join(codexHome, "skills", name)
				: scope === "System"
					? join(codexHome, "skills", ".system", name)
					: join("/etc/codex/skills", name);
	return join(root, SKILL_FILENAME);
}

export async function listCodexRepoSkills(cwd?: string): Promise<SkillListEntry[]> {
	const root = join(cwd || process.cwd(), ".codex", "skills");
	return await listSkillsInRoot(root, "project");
}

// ============================================================================
// Codex Custom Prompts (.codex/prompts + $CODEX_HOME/prompts)
// ============================================================================

export type CodexPrompt = {
	name: string;
	description?: string;
	argumentHint?: string;
	content: string;
	path: string;
	source: "project" | "user";
};

function parsePromptFrontmatter(content: string): { description?: string; argumentHint?: string } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) return {};
	const fm = frontmatterMatch[1]!;
	const descMatch = fm.match(/(?:^|\n)description:\s*"?(.+?)"?\s*$/m);
	const hintMatch = fm!.match(/(?:^|\n)argument-hint:\s*"?(.+?)"?\s*$/m);
	return {
		description: descMatch?.[1]?.trim() || undefined,
		argumentHint: hintMatch?.[1]?.trim() || undefined,
	};
}

/**
 * List Codex custom prompts from .codex/prompts/ (project) and $CODEX_HOME/prompts/ (user).
 * These are .md files with optional YAML frontmatter (description, argument-hint).
 */
export async function listCodexPrompts(cwd?: string): Promise<CodexPrompt[]> {
	const prompts: CodexPrompt[] = [];

	const scanDir = async (dir: string, source: "project" | "user") => {
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				if (!entry.name.endsWith(".md")) continue;
				if (entry.name.startsWith(".")) continue;

				const filePath = join(dir, entry.name);
				const name = entry.name.replace(/\.md$/, "");

				// Validate name
				if (!name || name === "." || name === "..") continue;

				try {
					const content = await readFile(filePath, "utf-8");
					const { description, argumentHint } = parsePromptFrontmatter(content);
					prompts.push({ name, description, argumentHint, content, path: filePath, source });
				} catch {
					prompts.push({ name, content: "", path: filePath, source });
				}
			}
		} catch {
			// Directory doesn't exist — fine
		}
	};

	// Project-level prompts
	if (cwd) {
		await scanDir(join(cwd, ".codex", "prompts"), "project");
	}

	// User-level prompts ($CODEX_HOME/prompts)
	await scanDir(join(codexHomeDir(), "prompts"), "user");

	prompts.sort((a, b) => a.name.localeCompare(b.name));
	return prompts;
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
