import { readdir, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'

export type OpenCodeFileSource = 'project' | 'user'

export type MarkdownFileEntry = {
  name: string
  path: string
  source: OpenCodeFileSource
  description?: string
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function validateName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && NAME_RE.test(name)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function parseFrontmatterDescription(content: string): string | undefined {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return
  const frontmatter = frontmatterMatch[1]
  const descMatch = frontmatter.match(/(?:^|\n)description:\s*(.+)\s*$/m)
  return descMatch?.[1]?.trim() || undefined
}

function configRoot(source: OpenCodeFileSource, cwd?: string): string {
  if (source === 'user') return join(homedir(), '.config', 'opencode')
  return join(cwd || process.cwd(), '.opencode')
}

function ensureSafeBasename(name: string): boolean {
  return name === basename(name)
}

export function commandFilePath(params: { name: string; source: OpenCodeFileSource; cwd?: string }): string {
  return join(configRoot(params.source, params.cwd), 'command', `${params.name}.md`)
}

export function agentFilePath(params: { name: string; source: OpenCodeFileSource; cwd?: string }): string {
  return join(configRoot(params.source, params.cwd), 'agent', `${params.name}.md`)
}

export async function listCommandFiles(cwd?: string): Promise<MarkdownFileEntry[]> {
  const out: MarkdownFileEntry[] = []
  const dirs: Array<{ source: OpenCodeFileSource; dir: string }> = [
    { source: 'user', dir: join(configRoot('user'), 'command') },
  ]
  if (cwd) dirs.unshift({ source: 'project', dir: join(configRoot('project', cwd), 'command') })

  for (const { source, dir } of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!entry.name.endsWith('.md')) continue
        const name = entry.name.replace(/\.md$/, '')
        if (!validateName(name)) continue
        if (!ensureSafeBasename(entry.name)) continue
        const path = join(dir, entry.name)
        if (!(await fileExists(path))) continue
        try {
          const content = await readFile(path, 'utf-8')
          out.push({ name, path, source, description: parseFrontmatterDescription(content) })
        } catch {
          out.push({ name, path, source })
        }
      }
    } catch {
      continue
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function listAgentFiles(cwd?: string): Promise<MarkdownFileEntry[]> {
  const out: MarkdownFileEntry[] = []
  const dirs: Array<{ source: OpenCodeFileSource; dir: string }> = [
    { source: 'user', dir: join(configRoot('user'), 'agent') },
  ]
  if (cwd) dirs.unshift({ source: 'project', dir: join(configRoot('project', cwd), 'agent') })

  for (const { source, dir } of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!entry.name.endsWith('.md')) continue
        const name = entry.name.replace(/\.md$/, '')
        if (!validateName(name)) continue
        if (!ensureSafeBasename(entry.name)) continue
        const path = join(dir, entry.name)
        if (!(await fileExists(path))) continue
        try {
          const content = await readFile(path, 'utf-8')
          out.push({ name, path, source, description: parseFrontmatterDescription(content) })
        } catch {
          out.push({ name, path, source })
        }
      }
    } catch {
      continue
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readMarkdownFile(path: string): Promise<string> {
  return await readFile(path, 'utf-8')
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

export async function deleteMarkdownFile(path: string): Promise<void> {
  await rm(path, { force: true })
}

