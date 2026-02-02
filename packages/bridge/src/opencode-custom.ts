import { readdir, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'

export type OpenCodeFileSource = 'project' | 'user'

export type MarkdownFileEntry = {
  name: string
  path: string
  source: OpenCodeFileSource
  description?: string
}

const NAME_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateName(name: string): boolean {
  const normalized = name.trim()
  if (normalized.length < 1 || normalized.length > 256) return false
  if (normalized.includes('\0')) return false
  if (normalized.startsWith('/')) return false
  if (normalized.includes('\\')) return false

  const parts = normalized.split('/')
  if (parts.some((p) => !p || p === '.' || p === '..' || !NAME_SEGMENT_RE.test(p))) {
    return false
  }
  return true
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

function commandDirs(source: OpenCodeFileSource, cwd?: string): string[] {
  const root = configRoot(source, cwd)
  return [join(root, 'commands'), join(root, 'command')]
}

function agentDirs(source: OpenCodeFileSource, cwd?: string): string[] {
  const root = configRoot(source, cwd)
  return [join(root, 'agents'), join(root, 'agent')]
}

export function commandFilePath(params: { name: string; source: OpenCodeFileSource; cwd?: string }): string {
  return join(configRoot(params.source, params.cwd), 'command', `${params.name}.md`)
}

export function agentFilePath(params: { name: string; source: OpenCodeFileSource; cwd?: string }): string {
  return join(configRoot(params.source, params.cwd), 'agent', `${params.name}.md`)
}

export async function resolveCommandFilePath(params: {
  name: string
  source: OpenCodeFileSource
  cwd?: string
}): Promise<string> {
  const candidates = commandDirs(params.source, params.cwd).map((d) => join(d, `${params.name}.md`))
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return candidates[1] // legacy singular
}

export async function resolveAgentFilePath(params: {
  name: string
  source: OpenCodeFileSource
  cwd?: string
}): Promise<string> {
  const candidates = agentDirs(params.source, params.cwd).map((d) => join(d, `${params.name}.md`))
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return candidates[1] // legacy singular
}

async function listMarkdownFiles(baseDir: string): Promise<string[]> {
  const out: string[] = []

  const visit = async (dir: string) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.md')) continue
      out.push(full)
    }
  }

  await visit(baseDir)
  return out
}

export async function listCommandFiles(cwd?: string): Promise<MarkdownFileEntry[]> {
  const out: MarkdownFileEntry[] = []
  const dirs: Array<{ source: OpenCodeFileSource; dir: string }> = []
  dirs.push({ source: 'user', dir: commandDirs('user')[0] })
  dirs.push({ source: 'user', dir: commandDirs('user')[1] })
  if (cwd) {
    dirs.unshift({ source: 'project', dir: commandDirs('project', cwd)[1] })
    dirs.unshift({ source: 'project', dir: commandDirs('project', cwd)[0] })
  }

  for (const { source, dir } of dirs) {
    try {
      const baseAbs = resolve(dir)
      const files = await listMarkdownFiles(baseAbs)
      for (const path of files) {
        if (!(await fileExists(path))) continue
        const rel = relative(baseAbs, path).replace(/\.md$/, '')
        const name = rel.split(/[\\/]/).join('/')
        if (!validateName(name)) continue
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
  const dirs: Array<{ source: OpenCodeFileSource; dir: string }> = []
  dirs.push({ source: 'user', dir: agentDirs('user')[0] })
  dirs.push({ source: 'user', dir: agentDirs('user')[1] })
  if (cwd) {
    dirs.unshift({ source: 'project', dir: agentDirs('project', cwd)[1] })
    dirs.unshift({ source: 'project', dir: agentDirs('project', cwd)[0] })
  }

  for (const { source, dir } of dirs) {
    try {
      const baseAbs = resolve(dir)
      const files = await listMarkdownFiles(baseAbs)
      for (const path of files) {
        if (!(await fileExists(path))) continue
        const rel = relative(baseAbs, path).replace(/\.md$/, '')
        const name = rel.split(/[\\/]/).join('/')
        if (!validateName(name)) continue
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
