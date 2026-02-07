import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename, relative } from 'node:path'
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
  ClaudeCodeSubagent,
  ClaudeCodeBeta,
  ClaudeCodeOutputFormat,
  ClaudeCodeSandboxSettings,
  ClaudeCodeSupportedModel,
  ClaudeCodeAccountInfo,
  ClaudeCodeMcpServerStatus,
  FileAttachment,
} from '../types'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CLAUDE_SETTINGS_FILE = join(homedir(), '.claude', 'settings.json')
const BROSKI_DIR = join(homedir(), '.broski')
const CC_CONFIG_FILE = join(BROSKI_DIR, 'claude-code-config.json')

type ActiveSession = {
  controller: AbortController
  cwd: string
  query?: { interrupt: () => Promise<void> }
  startedAt: number
}

const activeSessions = new Map<string, ActiveSession>()
const ccSupportedModelsByCwd = new Map<string, ClaudeCodeSupportedModel[]>()
const ccAccountInfoByCwd = new Map<string, ClaudeCodeAccountInfo>()
const ccMcpStatusByCwd = new Map<string, ClaudeCodeMcpServerStatus[]>()

let currentConfig: ClaudeCodeConfig = {
  permissionMode: 'default',
  allowedTools: [
    'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite',
    'Write', 'Edit', 'MultiEdit', 'Bash', 'NotebookEdit', 'Task',
  ],
  disallowedTools: [],
  model: 'sonnet',
  betas: [],
  enableAgentTeams: false,
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  // Defaults: Claude Code itself defaults to respecting .gitignore in file pickers.
  // Leave language/releaseChannel unset unless the user configures them.
  respectGitignore: true,
}

// Best-effort persisted config load (keeps Claude Code settings stable across bridge restarts).
try {
  if (existsSync(CC_CONFIG_FILE)) {
    const raw = readFileSync(CC_CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ClaudeCodeConfig>
    currentConfig = {
      ...currentConfig,
      ...parsed,
      ...(parsed.betas ? { betas: normalizeBetas(parsed.betas) } : {}),
    }
  }
} catch {
  // ignore (use defaults)
}

async function persistConfig(): Promise<void> {
  try {
    await mkdir(BROSKI_DIR, { recursive: true })
    await writeFile(CC_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[Claude Code] Failed to persist config:', err)
  }
}

async function readProjectSettings(cwd: string): Promise<Record<string, any>> {
  const settingsPath = join(cwd, '.claude', 'settings.json')
  try {
    const raw = await readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

async function writeProjectSettings(cwd: string, next: Record<string, any>): Promise<void> {
  const settingsPath = join(cwd, '.claude', 'settings.json')
  await mkdir(join(cwd, '.claude'), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf-8')
}

function applyProjectSettingsPatch(
  settings: Record<string, any>,
  patch: Pick<ClaudeCodeConfig, 'language' | 'releaseChannel' | 'respectGitignore'>,
): Record<string, any> {
  const next = { ...settings }

  if ('language' in patch) {
    const v = patch.language
    if (typeof v === 'string' && v.trim().length > 0) next.language = v.trim()
    else delete next.language
  }

  if ('releaseChannel' in patch) {
    const v = patch.releaseChannel
    if (v === 'stable' || v === 'latest') next.releaseChannel = v
    else delete next.releaseChannel
  }

  if ('respectGitignore' in patch) {
    const v = patch.respectGitignore
    if (typeof v === 'boolean') next.respectGitignore = v
    else delete next.respectGitignore
  }

  return next
}

function cwdCacheKey(cwd?: string): string {
  const normalized = (cwd || '').trim()
  return normalized.length > 0 ? normalized : '__global__'
}

function normalizeBetas(betas?: string[] | ClaudeCodeBeta[]): ClaudeCodeBeta[] | undefined {
  if (!Array.isArray(betas)) return undefined
  const normalized = Array.from(new Set(
    betas
      .map((b) => String(b).trim())
      .filter((b): b is ClaudeCodeBeta => b === 'context-1m-2025-08-07'),
  ))
  return normalized.length > 0 ? normalized : undefined
}

function fallbackSupportedModels(): ClaudeCodeSupportedModel[] {
  return [
    {
      value: 'sonnet',
      displayName: 'Claude Sonnet',
      description: 'Balanced model for coding and reasoning',
    },
    {
      value: 'opus',
      displayName: 'Claude Opus',
      description: 'High-capability model for complex tasks',
    },
    {
      value: 'haiku',
      displayName: 'Claude Haiku',
      description: 'Fast and efficient model for lightweight tasks',
    },
  ]
}

function _sanitizeFilename(name: string): string {
  const base = basename(name || 'attachment')
  return base.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}

function _extForMime(mimeType?: string | null): string {
  const mt = (mimeType || '').toLowerCase()
  if (mt === 'image/png') return '.png'
  if (mt === 'image/jpeg') return '.jpg'
  if (mt === 'image/jpg') return '.jpg'
  if (mt === 'image/webp') return '.webp'
  if (mt === 'image/gif') return '.gif'
  if (mt === 'image/bmp') return '.bmp'
  if (mt === 'image/tiff') return '.tiff'
  return ''
}

async function _writeImageAttachmentToDisk(cwd: string, attachment: FileAttachment): Promise<string | null> {
  const base64Data = attachment.base64Data
  if (!base64Data) return null

  const attachmentsDir = join(cwd, '.broski', 'cc-attachments')
  await mkdir(attachmentsDir, { recursive: true })

  const ext = _extForMime(attachment.mimeType) || (_sanitizeFilename(attachment.path).match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.jpg')
  const safeName = _sanitizeFilename(attachment.path || 'image')
  const token = randomBytes(6).toString('hex')
  const fileName = safeName.includes('.') ? safeName : `${safeName}${ext}`
  const outPath = join(attachmentsDir, `${Date.now()}_${token}_${fileName}`)

  const bytes = Buffer.from(base64Data, 'base64')
  await writeFile(outPath, bytes)
  return outPath
}

/**
 * Claude Code SDK doesn't have a first-class "attachments" parameter like OpenCode.
 * To support Broski's attachment UX, we:
 * - Pass file paths as explicit references in the prompt (Claude can Read them)
 * - Persist mobile-picked images to disk under the session cwd and reference them
 */
export async function preparePromptWithAttachments(
  prompt: string,
  cwd: string,
  fileAttachments?: FileAttachment[],
): Promise<string> {
  if (!fileAttachments || fileAttachments.length === 0) return prompt

  const lines: string[] = []

  for (const a of fileAttachments) {
    if (a.base64Data) {
      const savedPath = await _writeImageAttachmentToDisk(cwd, a)
      if (savedPath) {
        lines.push(`- Image: @${savedPath}`)
      }
      continue
    }

    if (!a.path) continue
    const prefix = a.isDirectory ? 'Directory' : 'File'
    const ref = a.path.startsWith('@') ? a.path : `@${a.path}`
    lines.push(`- ${prefix}: ${ref}`)
  }

  if (lines.length === 0) return prompt

  return [
    prompt,
    '',
    '---',
    'Attached context (via Broski):',
    ...lines,
    '',
    'If relevant, use the Read tool on the @paths above.',
  ].join('\n')
}

export type ClaudeCodeQueryOptions = {
  cwd: string
  sessionId?: string
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: ClaudeCodePermissionMode
  maxThinkingTokens?: number | null
  maxTurns?: number
  maxBudgetUsd?: number
  betas?: ClaudeCodeBeta[]
  variant?: string  // Named thinking level (low/medium/high/max) - maps to maxThinkingTokens
  systemPrompt?: string | { type: 'preset'; preset: string; append?: string } | null
  resumeSessionAt?: string
  outputFormat?: ClaudeCodeOutputFormat
  sandbox?: ClaudeCodeSandboxSettings
  enableAgentTeams?: boolean
  enableFileCheckpointing?: boolean
  agents?: Record<string, ClaudeCodeSubagent>  // Custom subagent definitions
  activeSubagent?: string  // Name of the subagent to use for this query (prepends prompt hint)
}

/**
 * Thinking level variants mapped to maxThinkingTokens values.
 * These provide user-friendly named presets for Claude's extended thinking feature.
 * Values chosen to match typical reasoning effort levels.
 */
const THINKING_VARIANTS: Record<string, number | null> = {
  'default': null,      // Use SDK default (no override)
  'low': 4096,          // Quick responses, minimal reasoning
  'medium': 16384,      // Balanced reasoning
  'high': 65536,        // Deep reasoning for complex tasks
  'max': null,          // Use model maximum (SDK default handles this)
}

/**
 * Convert a named variant to maxThinkingTokens value.
 * Returns undefined if variant is not recognized (allowing fallback to explicit maxThinkingTokens).
 */
function variantToThinkingTokens(variant?: string): number | null | undefined {
  if (!variant) return undefined
  const normalized = variant.toLowerCase()
  if (normalized in THINKING_VARIANTS) {
    return THINKING_VARIANTS[normalized]
  }
  return undefined
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
  // Normalize Windows backslashes to forward slashes for consistent encoding.
  // Claude Code encodes `/Users/me/repo` as `-Users-me-repo`.
  // On Windows, `C:\Users\me\repo` → `C:/Users/me/repo` → `-C:-Users-me-repo`.
  const normalized = path.replaceAll('\\', '/')
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

// Exposed for bridge-side real-time mirroring (tailing the Claude Code JSONL session file).
export async function resolveSessionFilePath(sessionId: string, cwd?: string): Promise<string | null> {
  return await findSessionFile(sessionId, cwd)
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

/**
 * Rename a Claude Code session by updating its title in the JSONL metadata.
 */
export async function renameSession(sessionId: string, name: string, cwd?: string): Promise<ClaudeCodeSession | null> {
  const projectPath = cwd || process.cwd()
  const encodedPath = encodeProjectPath(projectPath)
  const claudeDir = join(homedir(), '.claude', 'projects', encodedPath)
  const sessionFile = join(claudeDir, `${sessionId}.jsonl`)
  
  try {
    const content = await Bun.file(sessionFile).text()
    const lines = content.split('\n')
    
    // The first line contains session metadata - update the title
    if (lines.length > 0) {
      try {
        const firstLine = JSON.parse(lines[0])
        firstLine.title = name
        lines[0] = JSON.stringify(firstLine)
        await Bun.write(sessionFile, lines.join('\n'))
      } catch {
        // If first line isn't valid JSON, we can't rename
        return null
      }
    }
    
    return getSession(sessionId, cwd)
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
    const source: 'project' | 'user' = dir.startsWith(homedir()) ? 'user' : 'project'
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillPath = join(dir, entry.name, 'SKILL.md')
        try {
          const content = await readFile(skillPath, 'utf-8')
          const skill = parseSkillFile(entry.name, content)
          if (skill) {
            skills.push({ ...skill, source, path: skillPath })
          }
        } catch {
          skills.push({
            name: entry.name,
            autoInvoke: false,
            source,
            path: skillPath,
          })
        }
      }
    } catch {
      continue
    }
  }

  // Also include skills exposed by enabled plugins.
  try {
    const pluginsModule = await import('../plugins')
    const plugins = await pluginsModule.discoverPlugins(cwd)
    for (const plugin of plugins) {
      if (plugin.status !== 'enabled') continue
      const pluginSkills = Array.isArray(plugin.skills) ? plugin.skills : []
      if (pluginSkills.length === 0) continue

      for (const name of pluginSkills) {
        // Prefer explicit .claude/skills definitions if present.
        if (skills.some((s) => s.name === name)) continue

        const skillPath = join(plugin.path, 'skills', name, 'SKILL.md')
        try {
          const content = await readFile(skillPath, 'utf-8')
          const skill = parseSkillFile(name, content)
          skills.push({ ...skill, source: 'plugin', path: skillPath })
        } catch {
          skills.push({ name, autoInvoke: false, source: 'plugin', path: skillPath })
        }
      }
    }
  } catch {
    // ignore (plugins optional)
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

  let agent: string | undefined
  let context: 'fork' | undefined

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const agentMatch = frontmatter.match(/agent:\s*(.+)/)
    if (agentMatch) agent = agentMatch[1].trim()

    const contextMatch = frontmatter.match(/context:\s*(.+)/)
    if (contextMatch && contextMatch[1].trim() === 'fork') context = 'fork'
  }

  return { name, description, autoInvoke, tags: tags.length > 0 ? tags : undefined, agent, context }
}

export async function listHooks(cwd?: string): Promise<ClaudeCodeHook[]> {
  const hooks: ClaudeCodeHook[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'hooks'))
    searchDirs.push(join(cwd, 'hooks'))
  }

  searchDirs.push(join(homedir(), '.claude', 'hooks'))

  const parseHooksJson = (hooksJsonPath: string, source: 'project' | 'user' | 'plugin', content: string) => {
    const parsed = JSON.parse(content) as { hooks?: Record<string, any[]>; description?: string }
    if (!parsed.hooks) return
    let idx = 0
    for (const [event, matchers] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(matchers)) continue
      for (const entry of matchers) {
        const matcherValue =
          typeof entry?.matcher === 'string'
            ? entry.matcher
            : typeof entry?.matcher?.matcher === 'string'
              ? entry.matcher.matcher
              : undefined
        const enabled = typeof entry?.enabled === 'boolean' ? entry.enabled : true
        const hooksArr = Array.isArray(entry?.hooks) ? entry.hooks : undefined
        const description = typeof entry?.description === 'string' ? entry.description : undefined
        hooks.push({
          id: `${source}:${hooksJsonPath}:${event}:${idx++}`,
          event: event as any,
          matcher: matcherValue,
          enabled,
          description,
          hooks: hooksArr,
          source,
          path: hooksJsonPath,
        })
      }
    }
  }

  for (const dir of searchDirs) {
    const source: 'project' | 'user' = dir.startsWith(homedir()) ? 'user' : 'project'
    try {
      const hooksJsonPath = join(dir, 'hooks.json')
      const content = await readFile(hooksJsonPath, 'utf-8')
      parseHooksJson(hooksJsonPath, source, content)
    } catch {
      continue
    }
  }

  // Also include hooks exposed by enabled plugins.
  try {
    const pluginsModule = await import('../plugins')
    const plugins = await pluginsModule.discoverPlugins(cwd)
    for (const plugin of plugins) {
      if (plugin.status !== 'enabled') continue
      const hooksJsonPath = join(plugin.path, 'hooks', 'hooks.json')
      try {
        const content = await readFile(hooksJsonPath, 'utf-8')
        parseHooksJson(hooksJsonPath, 'plugin', content)
      } catch {
        // ignore missing hooks
      }
    }
  } catch {
    // ignore (plugins optional)
  }

  return hooks
}

async function scanCommandsRecursive(
  baseDir: string,
  currentDir: string,
  source: 'project' | 'user',
  out: ClaudeCodeCommand[],
): Promise<void> {
  try {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const fullPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await scanCommandsRecursive(baseDir, fullPath, source, out)
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const rel = relative(baseDir, fullPath)
      const withoutExt = rel.replace(/\.md$/, '')
      const name = withoutExt.replace(/[\\/]/g, ':')

      try {
        const content = await readFile(fullPath, 'utf-8')
        const cmd = parseCommandFile(name, content)
        out.push({ ...cmd, source, path: fullPath })
      } catch {
        out.push({ name, source, path: fullPath })
      }
    }
  } catch {
    // ignore (dir doesn't exist)
  }
}

export async function listCommands(cwd?: string): Promise<ClaudeCodeCommand[]> {
  const commands: ClaudeCodeCommand[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'commands'))
  }

  searchDirs.push(join(homedir(), '.claude', 'commands'))

  for (const dir of searchDirs) {
    const source: 'project' | 'user' = dir.startsWith(homedir()) ? 'user' : 'project'
    await scanCommandsRecursive(dir, dir, source, commands)
  }

  // Also include commands exposed by enabled plugins (so "/" autocomplete finds them).
  try {
    const pluginsModule = await import('../plugins')
    const plugins = await pluginsModule.discoverPlugins(cwd)
    for (const plugin of plugins) {
      if (plugin.status !== 'enabled') continue
      const pluginCommands = Array.isArray(plugin.commands) ? plugin.commands : []
      if (pluginCommands.length === 0) continue

      for (const name of pluginCommands) {
        // Prefer explicit .claude/commands definitions if present.
        if (commands.some((c) => c.name === name)) continue

        const filePath = join(plugin.path, 'commands', `${name}.md`)
        try {
          const content = await readFile(filePath, 'utf-8')
          commands.push({ ...parseCommandFile(name, content), source: 'plugin', path: filePath })
        } catch {
          commands.push({ name, source: 'plugin', path: filePath })
        }
      }
    }
  } catch {
    // ignore (plugins optional)
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

// ── Filesystem-based Agent Discovery ─────────────────────────────────
// Scans .claude/agents/ directories (project + user) for .md agent files.
// Each .md file defines a subagent that Claude Code auto-loads at session startup.
// See: https://code.claude.com/docs/en/sub-agents

import type { ClaudeCodeFilesystemAgent } from '../types'

function parseAgentFile(name: string, content: string): Omit<ClaudeCodeFilesystemAgent, 'source' | 'path'> {
  let description: string | undefined
  let tools: string[] | undefined
  let model: string | undefined
  let memory: 'user' | 'project' | 'local' | undefined

  // Parse YAML frontmatter if present
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]

    const descMatch = frontmatter.match(/description:\s*(.+)/)
    if (descMatch) description = descMatch[1].trim()

    const modelMatch = frontmatter.match(/model:\s*(.+)/)
    if (modelMatch) model = modelMatch[1].trim()

    const memoryMatch = frontmatter.match(/memory:\s*(.+)/)
    if (memoryMatch) {
      const scope = memoryMatch[1].trim().replace(/['"]/g, '') as 'user' | 'project' | 'local'
      if (scope === 'user' || scope === 'project' || scope === 'local') {
        memory = scope
      }
    }

    // Tools can be comma-separated or YAML array
    const toolsMatch = frontmatter.match(/tools:\s*\[([^\]]*)\]/)
    if (toolsMatch) {
      tools = toolsMatch[1].split(',').map(t => t.trim().replace(/["']/g, '')).filter(Boolean)
    } else {
      // Check for YAML list format
      const toolsListMatch = frontmatter.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/)
      if (toolsListMatch) {
        tools = toolsListMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*-\s*/, '').trim())
          .filter(Boolean)
      }
    }
  }

  // If no frontmatter description, use first non-empty line after frontmatter
  if (!description) {
    const bodyStart = frontmatterMatch ? content.indexOf('---', 4) + 3 : 0
    const body = content.slice(bodyStart).trim()
    const firstLine = body.split('\n').find(l => l.trim() && !l.startsWith('#'))
    if (firstLine) description = firstLine.trim().slice(0, 200)
  }

  // The full content (minus frontmatter) is the agent's prompt/instructions
  const promptStart = frontmatterMatch ? content.indexOf('---', 4) + 3 : 0
  const prompt = content.slice(promptStart).trim()

  return { name, description, prompt: prompt || undefined, tools, model, memory }
}

export async function listAgents(cwd?: string): Promise<ClaudeCodeFilesystemAgent[]> {
  const agents: ClaudeCodeFilesystemAgent[] = []
  const searchDirs: string[] = []

  if (cwd) {
    searchDirs.push(join(cwd, '.claude', 'agents'))
  }

  searchDirs.push(join(homedir(), '.claude', 'agents'))

  for (const dir of searchDirs) {
    const source: 'project' | 'user' = dir.startsWith(homedir()) ? 'user' : 'project'
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue

        const filePath = join(dir, entry.name)
        const name = entry.name.replace(/\.md$/, '')

        // Skip if we already have an agent with this name (project takes precedence)
        if (agents.some(a => a.name === name)) continue

        try {
          const content = await readFile(filePath, 'utf-8')
          const parsed = parseAgentFile(name, content)
          agents.push({ ...parsed, source, path: filePath })
        } catch {
          agents.push({ name, source, path: filePath })
        }
      }
    } catch {
      continue
    }
  }

  return agents
}

// ---------------------------------------------------------------------------
// Memory: read from ~/.claude/memory/ (user), .claude/memory/ (project),
// and ~/.claude/memory-local/ (local).
// The SDK writes memories as individual .md files in these directories.
// ---------------------------------------------------------------------------

import type { ClaudeCodeMemoryEntry } from '../types'

async function readMemoryDir(
  dir: string,
  scope: 'user' | 'project' | 'local',
): Promise<ClaudeCodeMemoryEntry[]> {
  const entries: ClaudeCodeMemoryEntry[] = []
  try {
    const files = await readdir(dir, { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile()) continue
      if (file.name.startsWith('.')) continue
      const filePath = join(dir, file.name)
      try {
        const content = await readFile(filePath, 'utf-8')
        // Try to extract date from filename (e.g. "2025-02-07T12-00-00.md")
        const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})/)
        entries.push({
          scope,
          filename: file.name,
          content: content.trim(),
          createdAt: dateMatch ? dateMatch[1] : undefined,
          path: filePath,
        })
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }
  return entries
}

export async function listMemories(
  scope?: 'user' | 'project' | 'local',
  cwd?: string,
): Promise<ClaudeCodeMemoryEntry[]> {
  const results: ClaudeCodeMemoryEntry[] = []
  const home = homedir()

  const dirs: Array<{ path: string; scope: 'user' | 'project' | 'local' }> = []
  if (!scope || scope === 'user') {
    dirs.push({ path: join(home, '.claude', 'memory'), scope: 'user' })
  }
  if (!scope || scope === 'project') {
    if (cwd) {
      dirs.push({ path: join(cwd, '.claude', 'memory'), scope: 'project' })
    }
  }
  if (!scope || scope === 'local') {
    dirs.push({ path: join(home, '.claude', 'memory-local'), scope: 'local' })
  }

  for (const { path, scope: s } of dirs) {
    const memories = await readMemoryDir(path, s)
    results.push(...memories)
  }

  // Sort newest first
  results.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return results
}

export async function deleteMemory(
  scope: 'user' | 'project' | 'local',
  filename: string,
  cwd?: string,
): Promise<boolean> {
  const home = homedir()
  let dir: string
  switch (scope) {
    case 'user':
      dir = join(home, '.claude', 'memory')
      break
    case 'project':
      if (!cwd) return false
      dir = join(cwd, '.claude', 'memory')
      break
    case 'local':
      dir = join(home, '.claude', 'memory-local')
      break
  }

  const filePath = join(dir, filename)
  // Security: ensure the resolved path is inside the expected directory
  const { realpath } = await import('fs/promises')
  try {
    const resolvedDir = await realpath(dir)
    const resolvedFile = await realpath(filePath)
    if (!resolvedFile.startsWith(resolvedDir)) return false
  } catch {
    return false
  }

  try {
    await (await import('fs/promises')).unlink(filePath)
    return true
  } catch {
    return false
  }
}

export async function getConfig(cwd?: string): Promise<ClaudeCodeConfig> {
  const cfg: ClaudeCodeConfig = { ...currentConfig }

  if (cwd) {
    const settings = await readProjectSettings(cwd)
    if (typeof settings.language === 'string' && settings.language.trim().length > 0) {
      cfg.language = settings.language.trim()
    }
    if (typeof settings.releaseChannel === 'string' && (settings.releaseChannel === 'stable' || settings.releaseChannel === 'latest')) {
      cfg.releaseChannel = settings.releaseChannel
    }
    if (typeof settings.respectGitignore === 'boolean') {
      cfg.respectGitignore = settings.respectGitignore
    }
  }

  return cfg
}

export async function setConfig(config: Partial<ClaudeCodeConfig>, cwd?: string): Promise<ClaudeCodeConfig> {
  const normalized: Partial<ClaudeCodeConfig> = {
    ...config,
    ...(config.betas ? { betas: normalizeBetas(config.betas) } : {}),
  }

  if ('maxTurns' in normalized && typeof normalized.maxTurns === 'number' && normalized.maxTurns <= 0) {
    normalized.maxTurns = undefined
  }
  if ('maxBudgetUsd' in normalized && typeof normalized.maxBudgetUsd === 'number' && normalized.maxBudgetUsd <= 0) {
    normalized.maxBudgetUsd = undefined
  }

  currentConfig = { ...currentConfig, ...normalized }

  // Persist our app-level defaults (allowedTools, systemPrompt, etc).
  // Fire-and-forget so the caller isn't blocked on IO.
  queueMicrotask(() => {
    persistConfig().catch(() => {})
  })

  // Also apply project-scoped settings when a cwd is provided.
  if (cwd) {
    const touchesProjectSettings =
      'language' in config ||
      'releaseChannel' in config ||
      'respectGitignore' in config

    if (touchesProjectSettings) {
      const settings = await readProjectSettings(cwd)
      const nextSettings = applyProjectSettingsPatch(settings, {
        language: config.language,
        releaseChannel: config.releaseChannel,
        respectGitignore: config.respectGitignore,
      })
      await writeProjectSettings(cwd, nextSettings)
    }
  }

  return await getConfig(cwd)
}

/**
 * Convert an array of ClaudeCodeSubagent to SDK's agents Record format.
 * The SDK expects agents as Record<name, { description, prompt, tools?, model? }>
 */
function convertSubagentsToRecord(subagents: ClaudeCodeSubagent[]): Record<string, { description: string; prompt: string; tools?: string[]; model?: string; permissionMode?: string; disallowedTools?: string[] }> {
  const record: Record<string, { description: string; prompt: string; tools?: string[]; model?: string; permissionMode?: string; disallowedTools?: string[] }> = {}
  for (const agent of subagents) {
    record[agent.name] = {
      description: agent.description,
      prompt: agent.prompt,
      ...(agent.tools?.length && { tools: agent.tools }),
      ...(agent.model && agent.model !== 'inherit' && { model: agent.model }),
      ...(agent.permissionMode && { permissionMode: agent.permissionMode }),
      ...(agent.disallowedTools?.length && { disallowedTools: agent.disallowedTools }),
    }
  }
  return record
}

function normalizeSupportedModels(models: unknown): ClaudeCodeSupportedModel[] {
  if (!Array.isArray(models)) return []
  const normalized = models
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const value = String((item as any).value ?? '').trim()
      if (!value) return null
      return {
        value,
        displayName: String((item as any).displayName ?? value).trim() || value,
        description: String((item as any).description ?? '').trim(),
      } satisfies ClaudeCodeSupportedModel
    })
    .filter((item): item is ClaudeCodeSupportedModel => item != null)
  return normalized
}

function normalizeAccountInfo(data: unknown): ClaudeCodeAccountInfo {
  if (!data || typeof data !== 'object') return {}
  const raw = data as Record<string, unknown>
  return {
    ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
    ...(typeof raw.organization === 'string' ? { organization: raw.organization } : {}),
    ...(typeof raw.subscriptionType === 'string' ? { subscriptionType: raw.subscriptionType } : {}),
    ...(typeof raw.tokenSource === 'string' ? { tokenSource: raw.tokenSource } : {}),
    ...(typeof raw.apiKeySource === 'string' ? { apiKeySource: raw.apiKeySource } : {}),
  }
}

function normalizeMcpServerStatuses(statuses: unknown): ClaudeCodeMcpServerStatus[] {
  if (!Array.isArray(statuses)) return []
  return statuses
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const name = String((item as any).name ?? '').trim()
      const status = String((item as any).status ?? '').trim()
      if (!name) return null
      if (status !== 'connected' && status !== 'failed' && status !== 'needs-auth' && status !== 'pending') {
        return null
      }
      const info = (item as any).serverInfo
      const serverInfo = info && typeof info === 'object'
        ? {
            name: String((info as any).name ?? '').trim(),
            version: String((info as any).version ?? '').trim(),
          }
        : undefined
      return {
        name,
        status,
        ...(serverInfo && serverInfo.name && serverInfo.version ? { serverInfo } : {}),
      } as ClaudeCodeMcpServerStatus
    })
    .filter((item): item is ClaudeCodeMcpServerStatus => item != null)
}

function normalizeModelUsage(
  modelUsage: unknown,
): Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearchRequests: number; costUSD: number; contextWindow: number }> | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined
  const entries = Object.entries(modelUsage as Record<string, unknown>)
  if (entries.length === 0) return undefined

  const normalizedEntries = entries
    .map(([modelName, usage]) => {
      if (!usage || typeof usage !== 'object') return null
      const raw = usage as Record<string, unknown>
      const normalized = {
        inputTokens: Number(raw.inputTokens ?? 0) || 0,
        outputTokens: Number(raw.outputTokens ?? 0) || 0,
        cacheReadInputTokens: Number(raw.cacheReadInputTokens ?? 0) || 0,
        cacheCreationInputTokens: Number(raw.cacheCreationInputTokens ?? 0) || 0,
        webSearchRequests: Number(raw.webSearchRequests ?? 0) || 0,
        costUSD: Number(raw.costUSD ?? 0) || 0,
        contextWindow: Number(raw.contextWindow ?? 0) || 0,
      }
      return [modelName, normalized] as const
    })
    .filter((item): item is readonly [string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; webSearchRequests: number; costUSD: number; contextWindow: number }] => item != null)

  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries)
}

function pickContextWindow(
  modelUsage: Record<string, { contextWindow: number }> | undefined,
  preferredModel?: string,
): number | undefined {
  if (!modelUsage || Object.keys(modelUsage).length === 0) return undefined
  if (preferredModel && modelUsage[preferredModel]?.contextWindow) {
    return modelUsage[preferredModel].contextWindow
  }
  const first = Object.values(modelUsage).find((entry) => entry.contextWindow > 0)
  return first?.contextWindow
}

function cacheCapabilities(
  cwd: string | undefined,
  capabilities: {
    supportedModels?: ClaudeCodeSupportedModel[]
    accountInfo?: ClaudeCodeAccountInfo
    mcpStatuses?: ClaudeCodeMcpServerStatus[]
  },
): void {
  const key = cwdCacheKey(cwd)
  if (capabilities.supportedModels && capabilities.supportedModels.length > 0) {
    ccSupportedModelsByCwd.set(key, capabilities.supportedModels)
  }
  if (capabilities.accountInfo && Object.keys(capabilities.accountInfo).length > 0) {
    ccAccountInfoByCwd.set(key, capabilities.accountInfo)
  }
  if (capabilities.mcpStatuses && capabilities.mcpStatuses.length > 0) {
    ccMcpStatusByCwd.set(key, capabilities.mcpStatuses)
  }
}

async function collectCapabilitiesFromQuery(
  q: any,
  cwd?: string,
): Promise<{
  supportedModels?: ClaudeCodeSupportedModel[]
  accountInfo?: ClaudeCodeAccountInfo
  mcpStatuses?: ClaudeCodeMcpServerStatus[]
}> {
  const [modelsResult, accountResult, mcpResult] = await Promise.allSettled([
    typeof q?.supportedModels === 'function' ? q.supportedModels() : Promise.resolve([]),
    typeof q?.accountInfo === 'function' ? q.accountInfo() : Promise.resolve({}),
    typeof q?.mcpServerStatus === 'function' ? q.mcpServerStatus() : Promise.resolve([]),
  ])

  const supportedModels = modelsResult.status === 'fulfilled'
    ? normalizeSupportedModels(modelsResult.value)
    : []
  const accountInfo = accountResult.status === 'fulfilled'
    ? normalizeAccountInfo(accountResult.value)
    : {}
  const mcpStatuses = mcpResult.status === 'fulfilled'
    ? normalizeMcpServerStatuses(mcpResult.value)
    : []

  cacheCapabilities(cwd, { supportedModels, accountInfo, mcpStatuses })

  return {
    ...(supportedModels.length > 0 ? { supportedModels } : {}),
    ...(Object.keys(accountInfo).length > 0 ? { accountInfo } : {}),
    ...(mcpStatuses.length > 0 ? { mcpStatuses } : {}),
  }
}

async function callActiveSessionCapability<T>(
  cwd: string | undefined,
  method: (q: any) => Promise<T>,
): Promise<T | undefined> {
  const normalizedCwd = (cwd || '').trim()
  for (const [, session] of activeSessions.entries()) {
    if (normalizedCwd && session.cwd !== normalizedCwd) continue
    const q = session.query as any
    if (!q) continue
    try {
      return await method(q)
    } catch {
      continue
    }
  }
  return undefined
}

export async function getSupportedModels(cwd?: string): Promise<ClaudeCodeSupportedModel[]> {
  const key = cwdCacheKey(cwd)
  const cached = ccSupportedModelsByCwd.get(key)
  if (cached && cached.length > 0) return cached

  const fromActive = await callActiveSessionCapability(cwd, async (q) => {
    const normalized = normalizeSupportedModels(await q.supportedModels())
    if (normalized.length > 0) {
      ccSupportedModelsByCwd.set(key, normalized)
    }
    return normalized
  })
  if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive

  const fallback = fallbackSupportedModels()
  ccSupportedModelsByCwd.set(key, fallback)
  return fallback
}

export async function getAccountInfo(cwd?: string): Promise<ClaudeCodeAccountInfo> {
  const key = cwdCacheKey(cwd)
  const cached = ccAccountInfoByCwd.get(key)
  if (cached) return cached

  const fromActive = await callActiveSessionCapability(cwd, async (q) => {
    const normalized = normalizeAccountInfo(await q.accountInfo())
    if (Object.keys(normalized).length > 0) {
      ccAccountInfoByCwd.set(key, normalized)
    }
    return normalized
  })
  if (fromActive && Object.keys(fromActive).length > 0) return fromActive

  return {}
}

export async function getMcpServerStatus(cwd?: string): Promise<ClaudeCodeMcpServerStatus[]> {
  const key = cwdCacheKey(cwd)
  const cached = ccMcpStatusByCwd.get(key)
  if (cached && cached.length > 0) return cached

  const fromActive = await callActiveSessionCapability(cwd, async (q) => {
    const normalized = normalizeMcpServerStatuses(await q.mcpServerStatus())
    if (normalized.length > 0) {
      ccMcpStatusByCwd.set(key, normalized)
    }
    return normalized
  })
  if (Array.isArray(fromActive) && fromActive.length > 0) return fromActive

  return []
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
    const enableCheckpointing = options.enableFileCheckpointing ?? true // Default to true for undo support
    const betas = normalizeBetas(options.betas ?? currentConfig.betas)
    const maxTurns = typeof options.maxTurns === 'number'
      ? options.maxTurns
      : currentConfig.maxTurns
    const maxBudgetUsd = typeof options.maxBudgetUsd === 'number'
      ? options.maxBudgetUsd
      : currentConfig.maxBudgetUsd
    const sandbox = options.sandbox ?? currentConfig.sandbox
    const outputFormat = options.outputFormat ?? currentConfig.outputFormat
    const enableAgentTeams = options.enableAgentTeams ?? currentConfig.enableAgentTeams ?? false

    const sdkOptions: any = {
      cwd: options.cwd,
      model: options.model || currentConfig.model || 'sonnet',
      allowedTools: options.allowedTools || currentConfig.allowedTools,
      disallowedTools: options.disallowedTools || currentConfig.disallowedTools,
      permissionMode: options.permissionMode || currentConfig.permissionMode,
      // Required for real-time text deltas (SDK docs: default is false).
      includePartialMessages: true,
      abortController: controller,
      settingSources: ['project', 'local', 'user'],
      // File checkpointing: enable tracking of file changes for undo/rewind support
      // Note: The env option was removed as it causes the SDK to hang.
      // enableFileCheckpointing alone should be sufficient for undo support.
      ...(enableCheckpointing && {
        enableFileCheckpointing: true,
        extraArgs: { 'replay-user-messages': null }, // Required to get user message UUIDs
      }),
    }

    if (Array.isArray(betas) && betas.length > 0) {
      sdkOptions.betas = betas
    }
    if (typeof maxTurns === 'number' && maxTurns > 0) {
      sdkOptions.maxTurns = maxTurns
    }
    if (typeof maxBudgetUsd === 'number' && maxBudgetUsd > 0) {
      sdkOptions.maxBudgetUsd = maxBudgetUsd
    }
    if (sandbox && typeof sandbox === 'object') {
      sdkOptions.sandbox = sandbox
    }
    if (outputFormat && typeof outputFormat === 'object') {
      sdkOptions.outputFormat = outputFormat
    }
    if (sdkOptions.permissionMode === 'bypassPermissions') {
      sdkOptions.allowDangerouslySkipPermissions = true
    }
    if (enableAgentTeams) {
      sdkOptions.env = {
        ...(process.env as Record<string, string | undefined>),
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      }
    }

    if (systemPrompt) {
      sdkOptions.systemPrompt = systemPrompt
    }

    // Custom subagents: Convert from our format to SDK's AgentDefinition format
    // Note: agents must include the Task tool in allowedTools for subagent invocation to work
    const agents = options.agents || (currentConfig.subagents?.length ? convertSubagentsToRecord(currentConfig.subagents) : undefined)
    if (agents && Object.keys(agents).length > 0) {
      // Ensure Task tool stays available when subagents are configured (SDK uses Task for invocation).
      if (Array.isArray(sdkOptions.allowedTools) && !sdkOptions.allowedTools.includes('Task')) {
        sdkOptions.allowedTools = [...sdkOptions.allowedTools, 'Task']
      }
      sdkOptions.agents = agents
    }

    // Custom MCP Tools: Load user-defined custom tools
    try {
      const customToolsModule = await import('../custom-tools')
      const customToolsServer = await customToolsModule.createCustomToolsServer()
      if (customToolsServer) {
        sdkOptions.mcpServers = {
          ...sdkOptions.mcpServers,
          'broski-custom-tools': customToolsServer,
        }
      }
    } catch (err) {
      // Custom tools are optional, log but don't fail
      console.warn('[Claude Code] Failed to load custom tools:', err)
    }

    // Load enabled plugins
    try {
      const pluginsModule = await import('../plugins')
      const enabledPlugins = await pluginsModule.getEnabledPluginsForSdk(options.cwd)
      if (enabledPlugins.length > 0) {
        sdkOptions.plugins = enabledPlugins
      }
    } catch (err) {
      // Plugins are optional, log but don't fail
      console.warn('[Claude Code] Failed to load plugins:', err)
    }

    if (options.sessionId) {
      sdkOptions.resume = options.sessionId
      if (options.resumeSessionAt) {
        sdkOptions.resumeSessionAt = options.resumeSessionAt
      }
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

    // If activeSubagent is specified, prepend an explicit invocation hint to the prompt
    // Per SDK docs: "To guarantee Claude uses a specific subagent, mention it by name in your prompt"
    let finalPrompt = prompt
    if (options.activeSubagent) {
      const agentName = options.activeSubagent
      // Check if this agent exists in the configured agents
      const agents = sdkOptions.agents || {}
      if (agents[agentName]) {
        finalPrompt = `Use the ${agentName} agent to handle this request.\n\n${prompt}`
      }
    }

    const q = query({ prompt: finalPrompt, options: sdkOptions })

    for await (const message of q as any) {
      // Extract parent_tool_use_id from SDK message for subagent context tracking.
      // When non-null, this message originated from inside a subagent's execution.
      const parentToolUseId = (message as any)?.parent_tool_use_id as string | undefined
      const emit = (msg: Record<string, unknown>) => onMessage(parentToolUseId ? { ...msg, parentToolUseId } : msg)

      // System init: session created + capabilities snapshot (tools/commands/etc)
      if (message?.type === 'system' && message?.subtype === 'init') {
        sessionId = message.session_id
        activeSessions.set(sessionId, {
          controller,
          cwd: options.cwd,
          query: q,
          startedAt: Date.now(),
        })
        emit({
          type: 'session-created',
          sessionId,
          agent: 'claude-code',
          model: message.model || sdkOptions.model,
        })

        const initMcpServers = Array.isArray(message.mcp_servers) ? message.mcp_servers : []
        const initMcpStatuses = normalizeMcpServerStatuses(
          initMcpServers.map((server: any) => ({
            name: server?.name,
            status: server?.status,
          })),
        )
        cacheCapabilities(options.cwd, { mcpStatuses: initMcpStatuses })

        let capabilities:
          | {
              supportedModels?: ClaudeCodeSupportedModel[]
              accountInfo?: ClaudeCodeAccountInfo
              mcpStatuses?: ClaudeCodeMcpServerStatus[]
            }
          | undefined
        try {
          capabilities = await collectCapabilitiesFromQuery(q, options.cwd)
        } catch {
          capabilities = undefined
        }

        emit({
          type: 'session-init',
          sessionId,
          model: message.model || sdkOptions.model,
          permissionMode: message.permissionMode || sdkOptions.permissionMode,
          tools: Array.isArray(message.tools) ? message.tools : [],
          slashCommands: Array.isArray(message.slash_commands) ? message.slash_commands : [],
          skills: Array.isArray(message.skills) ? message.skills : [],
          mcpServers: capabilities?.mcpStatuses ?? initMcpServers,
          plugins: Array.isArray(message.plugins) ? message.plugins : [],
          apiKeySource: message.apiKeySource,
          claudeCodeVersion: message.claude_code_version,
          supportedModels: capabilities?.supportedModels,
          accountInfo: capabilities?.accountInfo,
        })

        // Set thinking tokens: prefer explicit maxThinkingTokens, fallback to variant mapping
        let thinkingTokens = options.maxThinkingTokens
        if (thinkingTokens === undefined && options.variant) {
          thinkingTokens = variantToThinkingTokens(options.variant)
        }
        if (thinkingTokens !== undefined && typeof (q as any).setMaxThinkingTokens === 'function') {
          try {
            await (q as any).setMaxThinkingTokens(thinkingTokens)
          } catch {
            // ignore (control requests may not be enabled depending on transport mode)
          }
        }
      }

      if (message?.type === 'system' && message?.subtype === 'compact_boundary') {
        const trigger = message?.compact_metadata?.trigger === 'manual' ? 'manual' : 'auto'
        const preTokens = Number(message?.compact_metadata?.pre_tokens ?? 0)
        emit({
          type: 'compact-boundary',
          trigger,
          preTokens: Number.isFinite(preTokens) ? preTokens : 0,
        })
      }

      // Stream events: prefer these for real-time deltas (avoids double-emitting full assistant blocks)
      if (message?.type === 'stream_event' && message?.event) {
        sawStreamEvents = true
        const event = message.event as any
        const eventType = event?.type as string | undefined

        if (eventType === 'content_block_start') {
          const block = event?.content_block
          if (block?.type === 'text' && typeof block?.text === 'string' && block.text.length > 0) {
            emit({ type: 'assistant-message-delta', content: block.text })
          }
          if (block?.type === 'tool_use') {
            const toolName = block.name as string
            const toolInput = block.input as Record<string, unknown>
            
            emit({
              type: 'tool-call',
              tool: toolName,
              input: toolInput,
              toolUseId: block.id,
              status: 'running',
            })
            
            // Detect subagent invocations via Task tool
            // Per SDK docs, Task tool is used to invoke subagents with subagent_type in input
            if (toolName === 'Task') {
              const subagentType = toolInput?.subagent_type as string | undefined
              if (subagentType) {
                emit({
                  type: 'subagent-invocation',
                  subagentName: subagentType,
                  toolUseId: block.id,
                  prompt: toolInput?.prompt as string | undefined,
                  description: toolInput?.description as string | undefined,
                })
              }
            }
          }
        }

        if (eventType === 'content_block_delta') {
          const delta = event?.delta
          const deltaType = delta?.type as string | undefined
          if (deltaType === 'text_delta' && typeof delta?.text === 'string') {
            emit({ type: 'assistant-message-delta', content: delta.text })
          } else if (
            (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') &&
            typeof delta?.thinking === 'string'
          ) {
            emit({
              type: 'thinking-delta',
              content: delta.thinking,
              partId: typeof event?.index === 'number' ? `thinking_${event.index}` : undefined,
            })
          }
        }
      }

      // Tool progress signals (long-running tools)
      if (message?.type === 'tool_progress') {
        emit({
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
            emit({ type: 'assistant-message', content: block.text ?? '' })
          } else if (block?.type === 'tool_use') {
            const toolName = block.name as string
            const toolInput = block.input as Record<string, unknown>
            
            emit({
              type: 'tool-call',
              tool: toolName,
              input: toolInput,
              toolUseId: block.id,
              status: 'running',
            })
            
            // Detect subagent invocations via Task tool (fallback handler)
            if (toolName === 'Task') {
              const subagentType = toolInput?.subagent_type as string | undefined
              if (subagentType) {
                emit({
                  type: 'subagent-invocation',
                  subagentName: subagentType,
                  toolUseId: block.id,
                  prompt: toolInput?.prompt as string | undefined,
                  description: toolInput?.description as string | undefined,
                })
              }
            }
          }
        }
      }

      // Tool results can surface as "user" messages with tool_result blocks
      // User messages also contain checkpoint UUIDs when file checkpointing is enabled
      if (message?.type === 'user') {
        // Emit checkpoint if UUID is present (for file checkpointing/undo support)
        const checkpointUuid = message.uuid as string | undefined
        if (checkpointUuid && sessionId) {
          emit({
            type: 'checkpoint-created',
            sessionId,
            checkpointUuid,
            timestamp: Date.now(),
          })
        }

        const content = message.message?.content || []
        for (const block of content) {
          if (block?.type === 'tool_result') {
            emit({
              type: 'tool-result',
              toolUseId: block.tool_use_id,
              result: block.content,
              toolUseResult: (message as any).toolUseResult,
            })
          }
        }
      }

      // Result / token usage + cost (end of conversation - cumulative totals)
      if (message?.type === 'result') {
        if (typeof message.result === 'string' && message.result.trim().length > 0) {
          emit({ type: 'assistant-message', content: message.result })
        }
        if (message.usage) {
          const modelUsage = normalizeModelUsage(message.modelUsage)
          const contextWindow = pickContextWindow(modelUsage, sdkOptions.model)
          emit({
            type: 'token-usage',
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              cacheReadTokens: message.usage.cache_read_input_tokens,
              cacheCreationTokens: message.usage.cache_creation_input_tokens,
              ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
            },
            // Include cost if available (cumulative for entire session)
            totalCostUsd: message.usage.total_cost_usd,
            ...(modelUsage ? { modelUsage } : {}),
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

export function listActiveSessions(): Array<{
  sessionId: string
  cwd: string
  startedAt: number
}> {
  return Array.from(activeSessions.entries()).map(([sessionId, s]) => ({
    sessionId,
    cwd: s.cwd,
    startedAt: s.startedAt,
  }))
}

/**
 * Rewind files to a previous checkpoint state.
 * 
 * This restores files modified by Write/Edit/NotebookEdit tools to their state
 * at the specified checkpoint. The conversation history remains intact.
 * 
 * @param sessionId - The session ID to rewind
 * @param checkpointUuid - The checkpoint UUID to rewind to (from user message uuid)
 * @param cwd - Working directory of the session
 * @returns true if rewind succeeded, false otherwise
 */
export async function rewindToCheckpoint(
  sessionId: string,
  checkpointUuid: string,
  cwd: string,
): Promise<boolean> {
  try {
    // Resume the session with an empty prompt to get access to rewindFiles
    const resumeOptions: any = {
      cwd,
      resume: sessionId,
      enableFileCheckpointing: true,
      extraArgs: { 'replay-user-messages': null },
      env: { CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1' },
    }

    const q = query({ prompt: '', options: resumeOptions })

    // Call rewindFiles on the resumed query
    if (typeof (q as any).rewindFiles === 'function') {
      await (q as any).rewindFiles(checkpointUuid)
      
      // Consume the stream to complete the operation
      for await (const _message of q as any) {
        // Just drain the stream
      }
      
      return true
    } else {
      console.error('rewindFiles is not available on the query object')
      return false
    }
  } catch (error) {
    console.error('Failed to rewind to checkpoint:', error)
    return false
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
