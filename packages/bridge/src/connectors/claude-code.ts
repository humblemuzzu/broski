import { query } from '@anthropic-ai/claude-agent-sdk'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import type {
  PermissionResponse,
  ProjectSummary,
  ClaudeCodeSession,
  ClaudeCodeSkill,
  ClaudeCodeHook,
  ClaudeCodeCommand,
  ClaudeCodeConfig,
  ClaudeCodePermissionMode,
  ClaudeCodeStreamMessage,
  ClaudeCodeTranscriptMessage,
} from '../types'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CLAUDE_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json')

type ActiveSession = {
  controller: AbortController
  cwd: string
  query?: { interrupt: () => Promise<void> }
}

const activeSessions = new Map<string, ActiveSession>()

let currentConfig: ClaudeCodeConfig = {
  permissionMode: 'default',
  allowedTools: [
    'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite',
    'Write', 'Edit', 'MultiEdit', 'Bash', 'NotebookEdit', 'Task',
  ],
  disallowedTools: [],
  model: 'sonnet',
  systemPrompt: null,
}

export type ClaudeCodeQueryOptions = {
  cwd: string
  sessionId?: string
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: ClaudeCodePermissionMode
  maxThinkingTokens?: number | null
  systemPrompt?: string | { type: 'preset'; preset: string; append?: string } | null
}

/**
 * Claude Code stores per-project sessions under `~/.claude/projects/<projectKey>/`.
 * On macOS/Linux this is typically the absolute path with separators replaced by `-`,
 * e.g. `/Users/me/repo` -> `-Users-me-repo`.
 *
 * This encoding is not strictly reversible (paths can contain `-`), so we treat it
 * as a best-effort hint and fall back to scanning.
 */
function encodeProjectPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/')) return normalized.replaceAll('/', '-')
  return normalized.replaceAll('/', '-')
}

async function existsDir(path: string): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.isDirectory()
  } catch {
    return false
  }
}

async function getProjectSessionsDir(cwd: string): Promise<string> {
  const encoded = encodeProjectPath(cwd)
  const direct = join(CLAUDE_PROJECTS_DIR, encoded)
  if (await existsDir(direct)) return direct

  // Fallback: scan and pick the directory with a name suffix match to reduce collisions.
  const base = encoded.replaceAll(/^-+/, '')
  try {
    const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    const candidates = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(CLAUDE_PROJECTS_DIR, e.name))
      .filter((p) => p.endsWith(base))
    if (candidates.length > 0) return candidates[0]
  } catch {
    // ignore
  }

  return direct
}

type ClaudeTranscriptLine = {
  type?: string
  sessionId?: string
  session_id?: string
  uuid?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  slug?: string
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

function safeParseJsonLine(line: string): any | null {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function isLikelyCommandEcho(text: string): boolean {
  const t = text.trim()
  if (t.startsWith('<command-name>')) return true
  if (t.startsWith('<local-command-')) return true
  if (t.startsWith('<command-message>')) return true
  if (t.startsWith('<command-args>')) return true
  if (t.startsWith('<local-command-stdout>')) return true
  if (t.startsWith('<local-command-stderr>')) return true
  return false
}

function extractFirstTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object') {
        const type = (block as any).type
        if (type === 'text' && typeof (block as any).text === 'string') {
          return (block as any).text
        }
      }
    }
  }
  return null
}

function isoToMs(ts?: string): number {
  if (!ts) return Date.now()
  const parsed = Date.parse(ts)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function toolResultToText(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  if (Array.isArray(result)) {
    const parts: string[] = []
    for (const item of result) {
      if (item && typeof item === 'object') {
        const type = (item as any).type
        if (type === 'text' && typeof (item as any).text === 'string') {
          parts.push((item as any).text)
        } else if (typeof (item as any).text === 'string') {
          parts.push((item as any).text)
        } else {
          parts.push(JSON.stringify(item))
        }
      } else if (typeof item === 'string') {
        parts.push(item)
      }
    }
    return parts.join('\n').trim()
  }
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function structuredPatchToUnifiedDiff(filePath: string, patches: any[]): { diff: string; additions: number; deletions: number } | null {
  if (!Array.isArray(patches) || patches.length === 0) return null
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`
  let additions = 0
  let deletions = 0
  let body = ''

  for (const hunk of patches) {
    const oldStart = Number(hunk?.oldStart ?? 0)
    const oldLines = Number(hunk?.oldLines ?? 0)
    const newStart = Number(hunk?.newStart ?? 0)
    const newLines = Number(hunk?.newLines ?? 0)
    const lines = Array.isArray(hunk?.lines) ? hunk.lines : []
    body += `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n`
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      if (line.startsWith('-') && !line.startsWith('---')) deletions++
      body += `${line}\n`
    }
  }

  return { diff: header + body, additions, deletions }
}

function toolUseResultToDiff(toolUseResult: any): { diff?: string; before: string; after: string; file: string; additions: number; deletions: number } | null {
  if (!toolUseResult || typeof toolUseResult !== 'object') return null
  const filePath = toolUseResult.filePath as string | undefined
  if (!filePath) return null

  // If Claude Code provides structuredPatch, prefer a unified diff.
  const structuredPatch = toolUseResult.structuredPatch
  const patchDiff = structuredPatchToUnifiedDiff(filePath, structuredPatch)
  if (patchDiff) {
    return {
      file: filePath,
      before: '',
      after: '',
      diff: patchDiff.diff,
      additions: patchDiff.additions,
      deletions: patchDiff.deletions,
    }
  }

  // Fallback: best-effort from old/new string snippets.
  const before = typeof toolUseResult.oldString === 'string' ? toolUseResult.oldString : (typeof toolUseResult.originalFile === 'string' ? toolUseResult.originalFile : '')
  const after = typeof toolUseResult.newString === 'string' ? toolUseResult.newString : (typeof toolUseResult.content === 'string' ? toolUseResult.content : '')
  return {
    file: filePath,
    before,
    after,
    additions: 0,
    deletions: 0,
  }
}

async function readSessionPreview(filePath: string, maxBytes: number = 200_000): Promise<{
  cwd?: string
  model?: string
  title?: string
  slug?: string
}> {
  try {
    const preview = await Bun.file(filePath).slice(0, maxBytes).text()
    const lines = preview.split('\n').filter(Boolean)

    let cwd: string | undefined
    let model: string | undefined
    let title: string | undefined
    let slug: string | undefined

    for (const line of lines) {
      const parsed = safeParseJsonLine(line) as ClaudeTranscriptLine | null
      if (!parsed) continue
      if (!cwd && typeof parsed.cwd === 'string') cwd = parsed.cwd
      if (!slug && typeof parsed.slug === 'string') slug = parsed.slug
      if (!model && typeof parsed.message?.model === 'string') model = parsed.message.model

      if (!title && parsed.type === 'user' && parsed.message?.role === 'user' && parsed.isMeta !== true) {
        const maybeText = extractFirstTextContent(parsed.message?.content)
        if (maybeText && !isLikelyCommandEcho(maybeText)) {
          title = maybeText.trim().split('\n').find((l) => l.trim().length > 0)?.trim()
        }
      }

      if (cwd && title && model) break
    }

    if (title && title.length > 80) title = `${title.slice(0, 77)}…`
    return { cwd, model, title, slug }
  } catch {
    return {}
  }
}

async function findSessionFile(sessionId: string, cwd?: string): Promise<string | null> {
  const filename = `${sessionId}.jsonl`

  if (cwd) {
    const projectDir = await getProjectSessionsDir(cwd)
    const candidate = join(projectDir, filename)
    try {
      await stat(candidate)
      return candidate
    } catch {
      // fall back to scan
    }
  }

  try {
    const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(CLAUDE_PROJECTS_DIR, entry.name, filename)
      try {
        await stat(candidate)
        return candidate
      } catch {
        continue
      }
    }
  } catch {
    // ignore
  }

  return null
}

export async function listProjects(): Promise<ProjectSummary[]> {
  try {
    const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    const projects: ProjectSummary[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const dirPath = join(CLAUDE_PROJECTS_DIR, entry.name)
      const dirSt = await stat(dirPath).catch(() => null)

      // Best-effort: use the most recently modified session file to infer cwd.
      let latestFile: { path: string; mtime: number } | null = null
      try {
        const files = await readdir(dirPath)
        for (const f of files) {
          if (!f.endsWith('.jsonl')) continue
          const fp = join(dirPath, f)
          const st = await stat(fp).catch(() => null)
          if (!st) continue
          const mtime = st.mtime.getTime()
          if (!latestFile || mtime > latestFile.mtime) {
            latestFile = { path: fp, mtime }
          }
        }
      } catch {
        // ignore
      }

      const preview = latestFile ? await readSessionPreview(latestFile.path) : {}
      const cwd = preview.cwd
      if (!cwd) continue

      projects.push({
        id: cwd,
        name: basename(cwd),
        path: cwd,
        lastOpened: latestFile?.mtime ?? dirSt?.mtime?.getTime(),
      })
    }

    // Most recently touched first
    projects.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
    return projects
  } catch {
    return []
  }
}

export async function listSessions(cwd?: string): Promise<ClaudeCodeSession[]> {
  const sessions: ClaudeCodeSession[] = []

  try {
    let projectDirs: string[] = []

    if (cwd) {
      const projectDir = await getProjectSessionsDir(cwd)
      try {
        await stat(projectDir)
        projectDirs = [projectDir]
      } catch {
        return []
      }
    } else {
      try {
        const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
        projectDirs = entries
          .filter((e) => e.isDirectory())
          .map((e) => join(CLAUDE_PROJECTS_DIR, e.name))
      } catch {
        return []
      }
    }

    for (const projectDir of projectDirs) {
      try {
        const files = await readdir(projectDir)
        const sessionFiles = files.filter((f) => f.endsWith('.jsonl'))

        for (const file of sessionFiles) {
          const sessionId = basename(file, '.jsonl')
          const filePath = join(projectDir, file)
          const fileStat = await stat(filePath)

          const preview = await readSessionPreview(filePath)
          const sessionCwd = preview.cwd ?? cwd ?? ''

          // Filter if caller requested a specific cwd but directory encoding collided.
          if (cwd && sessionCwd && sessionCwd !== cwd) {
            continue
          }

          const derivedTitle =
            preview.title ||
            preview.slug ||
            (sessionCwd ? `${basename(sessionCwd)} • ${sessionId.slice(0, 8)}` : undefined)

          sessions.push({
            id: sessionId,
            title: derivedTitle || `Session ${sessionId.slice(0, 8)}`,
            cwd: sessionCwd || cwd || '',
            model: preview.model,
            createdAt: fileStat.birthtime.getTime(),
            updatedAt: fileStat.mtime.getTime(),
          })
        }
      } catch {
        continue
      }
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    return sessions
  } catch {
    return []
  }
}

export async function getSession(sessionId: string, cwd?: string): Promise<ClaudeCodeSession | null> {
  const filePath = await findSessionFile(sessionId, cwd)
  if (!filePath) return null

  const fileStat = await stat(filePath).catch(() => null)
  const preview = await readSessionPreview(filePath)
  const sessionCwd = preview.cwd ?? cwd ?? ''

  return {
    id: sessionId,
    title: preview.title || preview.slug || `Session ${sessionId.slice(0, 8)}`,
    cwd: sessionCwd,
    model: preview.model,
    createdAt: fileStat?.birthtime?.getTime() ?? Date.now(),
    updatedAt: fileStat?.mtime?.getTime() ?? Date.now(),
  }
}

export async function getSessionMessages(
  sessionId: string,
  cwd?: string,
  limit?: number,
): Promise<ClaudeCodeTranscriptMessage[]> {
  const filePath = await findSessionFile(sessionId, cwd)
  if (!filePath) return []

  try {
    const text = await Bun.file(filePath).text()
    const lines = text.split('\n').filter(Boolean)

    const messages: ClaudeCodeTranscriptMessage[] = []
    const toolIndexById = new Map<string, { messageIndex: number; toolIndex: number }>()

    for (const line of lines) {
      const parsed = safeParseJsonLine(line) as ClaudeTranscriptLine | null
      if (!parsed) continue

      // Skip non-message records (snapshots, etc.)
      if (parsed.type !== 'user' && parsed.type !== 'assistant') continue
      if (parsed.isMeta === true) continue
      if (!parsed.message) continue

      const role = parsed.message.role
      const createdAt = isoToMs(parsed.timestamp)
      const id = parsed.uuid || `${parsed.type}-${createdAt}`

      // User: plain prompt text
      if (role === 'user') {
        const maybeText = extractFirstTextContent(parsed.message.content)
        if (maybeText) {
          if (isLikelyCommandEcho(maybeText)) continue
          messages.push({
            id,
            role: 'user',
            createdAt,
            text: maybeText,
          })
          continue
        }

        // User: tool results (tool_result blocks) - attach to matching tool call.
        const content = parsed.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue
            if ((block as any).type !== 'tool_result') continue
            const toolUseId = (block as any).tool_use_id as string | undefined
            if (!toolUseId) continue

            const toolOutput = toolResultToText((block as any).content)
            const toolUseResult = (parsed as any).toolUseResult

            const idx = toolIndexById.get(toolUseId)
            if (!idx) continue
            const msg = messages[idx.messageIndex]
            const tool = msg.toolCalls?.[idx.toolIndex]
            if (!tool) continue

            const nextToolCalls = [...(msg.toolCalls ?? [])]
            const nextTool = {
              ...tool,
              status: 'completed',
              output: toolOutput || tool.output,
              metadata: {
                ...(tool.metadata ?? {}),
                ...(toolUseResult ? { toolUseResult } : {}),
              },
            }
            nextToolCalls[idx.toolIndex] = nextTool

            let nextDiffs = msg.diffs ?? []
            const diff = toolUseResultToDiff(toolUseResult)
            if (diff) {
              nextDiffs = [
                ...nextDiffs,
                {
                  file: diff.file,
                  before: diff.before,
                  after: diff.after,
                  diff: diff.diff,
                  additions: diff.additions,
                  deletions: diff.deletions,
                  partId: toolUseId,
                },
              ]
            }

            messages[idx.messageIndex] = {
              ...msg,
              toolCalls: nextToolCalls,
              diffs: nextDiffs,
            }
          }
        }

        continue
      }

      // Assistant: content blocks (thinking/text/tool_use)
      if (role === 'assistant') {
        const content = parsed.message.content
        const toolCalls: Array<{
          toolUseId: string
          tool: string
          input?: any
          status: 'running' | 'completed' | 'failed'
          output?: string
          metadata?: Record<string, unknown>
        }> = []

        let thinking = ''
        let textOut = ''

        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue
            const type = (block as any).type as string | undefined
            if (type === 'thinking' && typeof (block as any).thinking === 'string') {
              thinking += (block as any).thinking
            }
            if (type === 'text' && typeof (block as any).text === 'string') {
              textOut += (block as any).text
            }
            if (type === 'tool_use') {
              const toolUseId = (block as any).id as string | undefined
              const tool = (block as any).name as string | undefined
              const input = (block as any).input
              if (toolUseId && tool) {
                toolCalls.push({
                  toolUseId,
                  tool,
                  input,
                  status: 'running',
                })
              }
            }
          }
        } else if (typeof content === 'string') {
          textOut = content
        }

        const msgIndex = messages.length
        const builtToolCalls = toolCalls.length > 0 ? toolCalls : undefined
        messages.push({
          id,
          role: 'assistant',
          createdAt,
          text: textOut,
          ...(thinking.trim().length > 0 ? { thinking } : {}),
          ...(builtToolCalls ? { toolCalls: builtToolCalls } : {}),
          diffs: [],
        })

        if (builtToolCalls) {
          for (let i = 0; i < builtToolCalls.length; i++) {
            toolIndexById.set(builtToolCalls[i].toolUseId, { messageIndex: msgIndex, toolIndex: i })
          }
        }
      }
    }

    const filtered = messages.filter((m) => m.role !== 'system')
    if (limit && limit > 0 && filtered.length > limit) {
      return filtered.slice(filtered.length - limit)
    }
    return filtered
  } catch {
    return []
  }
}

export async function deleteSession(sessionId: string, cwd?: string): Promise<boolean> {
  try {
    const { unlink } = await import('node:fs/promises')

    if (cwd) {
      const projectDir = await getProjectSessionsDir(cwd)
      const filePath = join(projectDir, `${sessionId}.jsonl`)
      await unlink(filePath)
      return true
    }

    const entries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const filePath = join(CLAUDE_PROJECTS_DIR, entry.name, `${sessionId}.jsonl`)
      try {
        await unlink(filePath)
        return true
      } catch {
        continue
      }
    }
    return false
  } catch {
    return false
  }
}

export async function forkSession(sessionId: string, messageId?: string, cwd?: string): Promise<ClaudeCodeSession | null> {
  const { copyFile, writeFile } = await import('node:fs/promises')
  const { randomUUID } = await import('node:crypto')

  const sourceFile = await findSessionFile(sessionId, cwd)
  if (!sourceFile) return null

  try {
    const projectDir = await getProjectSessionsDir(cwd || process.cwd())
    const newSessionId = randomUUID()
    const destFile = join(projectDir, `${newSessionId}.jsonl`)

    if (messageId) {
      const text = await Bun.file(sourceFile).text()
      const lines = text.split('\n').filter(Boolean)
      const forkedLines: string[] = []

      for (const line of lines) {
        const parsed = safeParseJsonLine(line)
        forkedLines.push(line)
        if (parsed?.uuid === messageId) break
      }

      await writeFile(destFile, forkedLines.join('\n') + '\n', 'utf-8')
    } else {
      await copyFile(sourceFile, destFile)
    }

    return await getSession(newSessionId, cwd)
  } catch {
    return null
  }
}

export async function listSkills(cwd?: string): Promise<ClaudeCodeSkill[]> {
  const skills: ClaudeCodeSkill[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'skills'))
  }

  searchDirs.push(join(homedir(), '.claude', 'skills'))

  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(dir, entry.name, 'SKILL.md')
        try {
          const content = await readFile(skillPath, 'utf-8')
          const skill = parseSkillFile(entry.name, content)
          if (skill) {
            skills.push(skill)
          }
        } catch {
          skills.push({
            name: entry.name,
            autoInvoke: false,
          })
        }
      }
    } catch {
      continue
    }
  }

  return skills
}

function parseSkillFile(name: string, content: string): ClaudeCodeSkill {
  let description: string | undefined
  let autoInvoke = false
  const tags: string[] = []

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]

    const descMatch = frontmatter.match(/description:\s*(.+)/)
    if (descMatch) description = descMatch[1].trim()

    const autoMatch = frontmatter.match(/auto-invoke:\s*(true|false)/)
    if (autoMatch) autoInvoke = autoMatch[1] === 'true'

    const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]+)\]/)
    if (tagsMatch) {
      tags.push(...tagsMatch[1].split(',').map((t) => t.trim().replace(/['"]/g, '')))
    }
  }

  return { name, description, autoInvoke, tags: tags.length > 0 ? tags : undefined }
}

export async function listHooks(cwd?: string): Promise<ClaudeCodeHook[]> {
  const hooks: ClaudeCodeHook[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'hooks'))
    searchDirs.push(join(cwd, 'hooks'))
  }

  searchDirs.push(join(homedir(), '.claude', 'hooks'))

  for (const dir of searchDirs) {
    try {
      const hooksJsonPath = join(dir, 'hooks.json')
      const content = await readFile(hooksJsonPath, 'utf-8')
      const parsed = JSON.parse(content) as { hooks?: Record<string, any[]> }

      if (parsed.hooks) {
        let hookIndex = 0
        for (const [event, matchers] of Object.entries(parsed.hooks)) {
          for (const matcher of matchers) {
            hooks.push({
              id: `${event}-${hookIndex++}`,
              event: event as any,
              matcher: matcher.matcher,
              enabled: true,
              description: matcher.description,
            })
          }
        }
      }
    } catch {
      continue
    }
  }

  return hooks
}

export async function listCommands(cwd?: string): Promise<ClaudeCodeCommand[]> {
  const commands: ClaudeCodeCommand[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'commands'))
  }

  searchDirs.push(join(homedir(), '.claude', 'commands'))

  for (const dir of searchDirs) {
    try {
      const entries = await readdir(dir)
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue

        const name = basename(entry, '.md')
        const filePath = join(dir, entry)

        try {
          const content = await readFile(filePath, 'utf-8')
          const cmd = parseCommandFile(name, content)
          commands.push(cmd)
        } catch {
          commands.push({ name })
        }
      }
    } catch {
      continue
    }
  }

  return commands
}

function parseCommandFile(name: string, content: string): ClaudeCodeCommand {
  let description: string | undefined
  let agent: string | undefined
  let model: string | undefined
  let subtask = false

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]

    const descMatch = frontmatter.match(/description:\s*(.+)/)
    if (descMatch) description = descMatch[1].trim()

    const agentMatch = frontmatter.match(/agent:\s*(.+)/)
    if (agentMatch) agent = agentMatch[1].trim()

    const modelMatch = frontmatter.match(/model:\s*(.+)/)
    if (modelMatch) model = modelMatch[1].trim()

    const subtaskMatch = frontmatter.match(/subtask:\s*(true|false)/)
    if (subtaskMatch) subtask = subtaskMatch[1] === 'true'
  }

  return { name, description, agent, model, subtask }
}

export function getConfig(): ClaudeCodeConfig {
  return { ...currentConfig }
}

export function setConfig(config: Partial<ClaudeCodeConfig>): ClaudeCodeConfig {
  currentConfig = { ...currentConfig, ...config }
  return { ...currentConfig }
}

export async function queryClaudeCode(
  prompt: string,
  options: ClaudeCodeQueryOptions,
  onMessage: (message: ClaudeCodeStreamMessage) => void,
  onComplete: (sessionId: string) => void,
  onError: (error: Error) => void,
  onPermissionRequest?: (request: {
    sessionId: string
    toolUseId: string
    tool: string
    input: Record<string, unknown>
    decisionReason?: string
    blockedPath?: string
    hasSuggestions?: boolean
  }) => Promise<PermissionResponse>,
): Promise<void> {
  let sessionId: string | null = options.sessionId || null
  const controller = new AbortController()
  let sawStreamEvents = false

  try {
    const systemPrompt = options.systemPrompt ?? currentConfig.systemPrompt
    const sdkOptions: any = {
      cwd: options.cwd,
      model: options.model || currentConfig.model || 'sonnet',
      allowedTools: options.allowedTools || currentConfig.allowedTools,
      disallowedTools: options.disallowedTools || currentConfig.disallowedTools,
      permissionMode: options.permissionMode || currentConfig.permissionMode,
      abortController: controller,
      settingSources: ['project'],
    }

    if (systemPrompt) {
      sdkOptions.systemPrompt = systemPrompt
    }

    if (options.sessionId) {
      sdkOptions.resume = options.sessionId
    }

    if (onPermissionRequest) {
      sdkOptions.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        ctx: {
          toolUseID: string
          suggestions?: unknown[]
          blockedPath?: string
          decisionReason?: string
        },
      ) => {
        const sid = sessionId ?? options.sessionId ?? ''
        const response = await onPermissionRequest({
          sessionId: sid,
          toolUseId: ctx.toolUseID,
          tool: toolName,
          input,
          decisionReason: ctx.decisionReason,
          blockedPath: ctx.blockedPath,
          hasSuggestions: Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0,
        })

        if (response === 'reject') {
          return {
            behavior: 'deny',
            message: 'User denied permission',
            interrupt: true,
            toolUseID: ctx.toolUseID,
          }
        }

        return {
          behavior: 'allow',
          updatedInput: input,
          ...(response === 'always' && Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0
            ? { updatedPermissions: ctx.suggestions }
            : {}),
          toolUseID: ctx.toolUseID,
        }
      }
    }

    const q = query({ prompt, options: sdkOptions })

    for await (const message of q as any) {
      // System init: session created + capabilities snapshot (tools/commands/etc)
      if (message?.type === 'system' && message?.subtype === 'init') {
        sessionId = message.session_id
        activeSessions.set(sessionId, { controller, cwd: options.cwd, query: q })
        onMessage({
          type: 'session-created',
          sessionId,
          agent: 'claude-code',
          model: message.model || sdkOptions.model,
        })
        onMessage({
          type: 'session-init',
          sessionId,
          model: message.model || sdkOptions.model,
          permissionMode: message.permissionMode || sdkOptions.permissionMode,
          tools: Array.isArray(message.tools) ? message.tools : [],
          slashCommands: Array.isArray(message.slash_commands) ? message.slash_commands : [],
          skills: Array.isArray(message.skills) ? message.skills : [],
          mcpServers: Array.isArray(message.mcp_servers) ? message.mcp_servers : [],
          plugins: Array.isArray(message.plugins) ? message.plugins : [],
          apiKeySource: message.apiKeySource,
          claudeCodeVersion: message.claude_code_version,
        })

        if (options.maxThinkingTokens !== undefined && typeof (q as any).setMaxThinkingTokens === 'function') {
          try {
            await (q as any).setMaxThinkingTokens(options.maxThinkingTokens)
          } catch {
            // ignore (control requests may not be enabled depending on transport mode)
          }
        }
      }

      // Stream events: prefer these for real-time deltas (avoids double-emitting full assistant blocks)
      if (message?.type === 'stream_event' && message?.event) {
        sawStreamEvents = true
        const event = message.event as any
        const eventType = event?.type as string | undefined

        if (eventType === 'content_block_start') {
          const block = event?.content_block
          if (block?.type === 'tool_use') {
            onMessage({
              type: 'tool-call',
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
              status: 'running',
            })
          }
        }

        if (eventType === 'content_block_delta') {
          const delta = event?.delta
          const deltaType = delta?.type as string | undefined
          if (deltaType === 'text_delta' && typeof delta?.text === 'string') {
            onMessage({ type: 'assistant-message-delta', content: delta.text })
          } else if (
            (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') &&
            typeof delta?.thinking === 'string'
          ) {
            onMessage({
              type: 'thinking-delta',
              content: delta.thinking,
              partId: typeof event?.index === 'number' ? `thinking_${event.index}` : undefined,
            })
          }
        }
      }

      // Tool progress signals (long-running tools)
      if (message?.type === 'tool_progress') {
        onMessage({
          type: 'tool-call',
          tool: message.tool_name,
          input: { elapsedSeconds: message.elapsed_time_seconds },
          toolUseId: message.tool_use_id,
          status: 'running',
        })
      }

      // Full assistant message (fallback if stream events are not emitted)
      if (!sawStreamEvents && message?.type === 'assistant') {
        const content = message.message?.content || []
        for (const block of content) {
          if (block?.type === 'text') {
            onMessage({ type: 'assistant-message', content: block.text ?? '' })
          } else if (block?.type === 'tool_use') {
            onMessage({
              type: 'tool-call',
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
              status: 'running',
            })
          }
        }
      }

      // Tool results can surface as "user" messages with tool_result blocks
      if (message?.type === 'user') {
        const content = message.message?.content || []
        for (const block of content) {
          if (block?.type === 'tool_result') {
            onMessage({
              type: 'tool-result',
              toolUseId: block.tool_use_id,
              result: block.content,
              toolUseResult: (message as any).toolUseResult,
            })
          }
        }
      }

      // Result / token usage + cost (end of turn)
      if (message?.type === 'result') {
        if (message.usage) {
          onMessage({
            type: 'token-usage',
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              cacheReadTokens: message.usage.cache_read_input_tokens,
            },
          })
        }
      }

      // Auth status events can be surfaced as an error (UI should guide user)
      if (message?.type === 'auth_status' && message?.error) {
        onError(new Error(String(message.error)))
        return
      }
    }

    if (sessionId) {
      activeSessions.delete(sessionId)
    }
    onComplete(sessionId || '')
  } catch (error) {
    if (sessionId) {
      activeSessions.delete(sessionId)
    }
    onError(error as Error)
  }
}

export async function abortClaudeCode(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId)
  if (session) {
    try {
      await session.query?.interrupt?.()
    } catch {
      // ignore
    }
    session.controller.abort()
    activeSessions.delete(sessionId)
  }
}

export async function checkClaudeCodeAvailable(): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true
  try {
    await stat(CLAUDE_SETTINGS_FILE)
    return true
  } catch {
    return false
  }
}

export function checkAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}
