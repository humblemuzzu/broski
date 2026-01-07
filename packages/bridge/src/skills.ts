import { readdir, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type SkillSource = 'project' | 'user' | 'system' | 'admin' | 'plugin'

export type SkillListEntry = {
  name: string
  description?: string
  path: string
  source: SkillSource
  editable: boolean
}

const SKILL_FILENAME = 'SKILL.md'
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function validateSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && SKILL_NAME_RE.test(name)
}

function parseDescriptionFromFrontmatter(content: string): string | undefined {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return
  const frontmatter = frontmatterMatch[1]
  const descMatch = frontmatter.match(/(?:^|\n)description:\s*(.+)\s*$/m)
  return descMatch?.[1]?.trim() || undefined
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listSkillsInRoot(rootDir: string, source: SkillSource): Promise<SkillListEntry[]> {
  const out: SkillListEntry[] = []
  try {
    const entries = await readdir(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const dir = join(rootDir, entry.name)
      const skillPath = join(dir, SKILL_FILENAME)
      if (!(await fileExists(skillPath))) continue
      try {
        const content = await readFile(skillPath, 'utf-8')
        out.push({
          name: entry.name,
          description: parseDescriptionFromFrontmatter(content),
          path: skillPath,
          source,
          editable: source === 'project' || source === 'user',
        })
      } catch {
        out.push({
          name: entry.name,
          path: skillPath,
          source,
          editable: source === 'project' || source === 'user',
        })
      }
    }
  } catch {
    // ignore
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// ============================================================================
// OpenCode Skills (.opencode/skill + ~/.config/opencode/skill)
// ============================================================================

export function getOpenCodeSkillFilePath(params: {
  name: string
  source: Extract<SkillSource, 'project' | 'user'>
  cwd?: string
}): string {
  const { name, source } = params
  const cwd = params.cwd || process.cwd()
  const base =
    source === 'project'
      ? join(cwd, '.opencode', 'skill', name)
      : join(homedir(), '.config', 'opencode', 'skill', name)
  return join(base, SKILL_FILENAME)
}

export async function listOpenCodeSkills(cwd?: string): Promise<SkillListEntry[]> {
  const userRoot = join(homedir(), '.config', 'opencode', 'skill')
  const user = await listSkillsInRoot(userRoot, 'user')
  if (!cwd) return user
  const projectRoot = join(cwd, '.opencode', 'skill')
  const project = await listSkillsInRoot(projectRoot, 'project')
  return [...project, ...user]
}

// ============================================================================
// Claude Code Skills (.claude/skills + ~/.claude/skills)
// ============================================================================

export function getClaudeCodeSkillFilePath(params: {
  name: string
  source: Extract<SkillSource, 'project' | 'user'>
  cwd?: string
}): string {
  const { name, source } = params
  const cwd = params.cwd || process.cwd()
  const base =
    source === 'project'
      ? join(cwd, '.claude', 'skills', name)
      : join(homedir(), '.claude', 'skills', name)
  return join(base, SKILL_FILENAME)
}

export async function listClaudeCodeSkills(cwd?: string): Promise<SkillListEntry[]> {
  const projectRoot = join(cwd || process.cwd(), '.claude', 'skills')
  const userRoot = join(homedir(), '.claude', 'skills')
  const [project, user] = await Promise.all([
    listSkillsInRoot(projectRoot, 'project'),
    listSkillsInRoot(userRoot, 'user'),
  ])
  return [...project, ...user]
}

// ============================================================================
// Codex Skills (.codex/skills + $CODEX_HOME/skills + system/admin)
// ============================================================================

export type CodexSkillScope = 'Repo' | 'User' | 'System' | 'Admin'

export function codexHomeDir(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

export function getCodexSkillFilePath(params: {
  name: string
  scope: CodexSkillScope
  cwd?: string
}): string {
  const { name, scope } = params
  const cwd = params.cwd || process.cwd()
  const codexHome = codexHomeDir()
  const root =
    scope === 'Repo'
      ? join(cwd, '.codex', 'skills', name)
      : scope === 'User'
        ? join(codexHome, 'skills', name)
        : scope === 'System'
          ? join(codexHome, 'skills', '.system', name)
          : join('/etc/codex/skills', name)
  return join(root, SKILL_FILENAME)
}

export async function listCodexRepoSkills(cwd?: string): Promise<SkillListEntry[]> {
  const root = join(cwd || process.cwd(), '.codex', 'skills')
  return await listSkillsInRoot(root, 'project')
}

export async function readSkillFile(skillPath: string): Promise<string> {
  return await readFile(skillPath, 'utf-8')
}

export async function writeSkillFile(skillPath: string, content: string): Promise<void> {
  const dir = resolve(skillPath, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(skillPath, content, 'utf-8')
}

export async function deleteSkillByPath(skillPath: string): Promise<void> {
  const dir = resolve(skillPath, '..')
  await rm(dir, { recursive: true, force: true })
}
