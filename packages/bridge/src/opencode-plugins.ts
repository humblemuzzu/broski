import { readdir, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'

export type OpenCodePluginSource = 'project' | 'user'

export type OpenCodePluginFile = {
  name: string
  path: string
  source: OpenCodePluginSource
}

// OpenCode upstream only scans `{plugin,plugins}/*.{ts,js}`.
const ALLOWED_EXTS = ['.js', '.ts']

function hasAllowedExt(name: string): boolean {
  return ALLOWED_EXTS.some((ext) => name.endsWith(ext))
}

export function validatePluginFilename(name: string): boolean {
  if (!name || name.length > 128) return false
  if (name !== basename(name)) return false
  if (!hasAllowedExt(name)) return false
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

function pluginDir(source: OpenCodePluginSource, cwd?: string): string {
  if (source === 'user') return join(homedir(), '.config', 'opencode')
  return join(cwd || process.cwd(), '.opencode')
}

function pluginDirs(source: OpenCodePluginSource, cwd?: string): string[] {
  const root = pluginDir(source, cwd)
  // Prefer plural directory for new writes, but support legacy singular for reads.
  return [join(root, 'plugins'), join(root, 'plugin')]
}

export function getPluginFilePath(params: {
  source: OpenCodePluginSource
  cwd?: string
  name: string
}): string {
  return join(pluginDirs(params.source, params.cwd)[0], params.name)
}

export async function resolvePluginFilePath(params: {
  source: OpenCodePluginSource
  cwd?: string
  name: string
}): Promise<string> {
  const candidates = pluginDirs(params.source, params.cwd).map((d) => join(d, params.name))
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return candidates[0]
}

export async function listPluginFiles(cwd?: string): Promise<OpenCodePluginFile[]> {
  const out: OpenCodePluginFile[] = []

  const dirs: Array<{ source: OpenCodePluginSource; dir: string }> = [
    { source: 'user', dir: pluginDirs('user')[0] },
    { source: 'user', dir: pluginDirs('user')[1] },
  ]
  if (cwd) {
    dirs.unshift({ source: 'project', dir: pluginDirs('project', cwd)[1] })
    dirs.unshift({ source: 'project', dir: pluginDirs('project', cwd)[0] })
  }

  for (const { source, dir } of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (!validatePluginFilename(entry.name)) continue
        const path = join(dir, entry.name)
        if (!(await fileExists(path))) continue
        out.push({ name: entry.name, path, source })
      }
    } catch {
      continue
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readPluginFile(path: string): Promise<string> {
  return await readFile(path, 'utf-8')
}

export async function writePluginFile(path: string, content: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

export async function deletePluginFile(path: string): Promise<void> {
  await rm(path, { force: true })
}
