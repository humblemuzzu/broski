import { readdir, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'

export type OpenCodePluginSource = 'project' | 'user'

export type OpenCodePluginFile = {
  name: string
  path: string
  source: OpenCodePluginSource
}

const ALLOWED_EXTS = ['.js', '.ts', '.mjs', '.cjs']

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
  if (source === 'user') return join(homedir(), '.config', 'opencode', 'plugin')
  return join(cwd || process.cwd(), '.opencode', 'plugin')
}

export function getPluginFilePath(params: {
  source: OpenCodePluginSource
  cwd?: string
  name: string
}): string {
  return join(pluginDir(params.source, params.cwd), params.name)
}

export async function listPluginFiles(cwd?: string): Promise<OpenCodePluginFile[]> {
  const out: OpenCodePluginFile[] = []

  const dirs: Array<{ source: OpenCodePluginSource; dir: string }> = [
    { source: 'user', dir: pluginDir('user') },
  ]
  if (cwd) dirs.unshift({ source: 'project', dir: pluginDir('project', cwd) })

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

