import type { ServerWebSocket } from 'bun'
import { mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { OpenCodeConnector } from './connectors/opencode'
import type { AgentType, ClientMessage, CodexStreamMessage, CodexThread, CodexTranscriptMessage, DeviceInfo, FileAttachment, PermissionResponse, ServerMessage } from './types'
import * as claudeCode from './connectors/claude-code'
import * as codexFs from './connectors/codex-fs'
import * as fileSearch from './file-search'
import { CodexAppServerClient, checkCodexAvailable } from './connectors/codex'
import { headTailTruncate } from './utils'

const TOKEN_FILE = resolve(homedir(), '.broski', 'token')
const DEBUG_ARTIFACTS = process.env.BROSKI_DEBUG_ARTIFACTS === '1'
const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === '1' // Real-Time Sync debugging

// Feature flag: Set to true to re-enable artifacts feature
// TODO(artifacts): Set to true when feature is ready for production
const ARTIFACTS_ENABLED = false

// Lazy imports for artifacts - only load when enabled
// This prevents DB initialization logs when artifacts are disabled
let artifactIndex: Awaited<typeof import('./artifacts')>['artifactIndex'] | null = null
let getArtifactsConfig: typeof import('./artifacts/config')['getArtifactsConfig'] | null = null
let getArtifactsDbSizeBytes: typeof import('./artifacts/config')['getArtifactsDbSizeBytes'] | null = null
let setArtifactsConfig: typeof import('./artifacts/config')['setArtifactsConfig'] | null = null
let getArtifactsDbPath: typeof import('./artifacts/db')['getArtifactsDbPath'] | null = null

async function initArtifactsIfEnabled() {
  if (!ARTIFACTS_ENABLED || artifactIndex) return
  const artifacts = await import('./artifacts')
  const config = await import('./artifacts/config')
  const db = await import('./artifacts/db')
  artifactIndex = artifacts.artifactIndex
  getArtifactsConfig = config.getArtifactsConfig
  getArtifactsDbSizeBytes = config.getArtifactsDbSizeBytes
  setArtifactsConfig = config.setArtifactsConfig
  getArtifactsDbPath = db.getArtifactsDbPath
}

function structuredPatchToUnifiedDiff(filePath: string, patches: unknown): string | null {
  if (!Array.isArray(patches) || patches.length === 0) return null
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`
  let body = ''
  for (const hunk of patches) {
    if (!hunk || typeof hunk !== 'object') continue
    const oldStart = Number((hunk as any).oldStart ?? 0)
    const oldLines = Number((hunk as any).oldLines ?? 0)
    const newStart = Number((hunk as any).newStart ?? 0)
    const newLines = Number((hunk as any).newLines ?? 0)
    body += `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n`
    const lines = Array.isArray((hunk as any).lines) ? (hunk as any).lines : []
    for (const line of lines) {
      if (typeof line !== 'string') continue
      body += `${line}\n`
    }
  }
  return header + body
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isSafeClaudeCommandName(name: string): boolean {
  const trimmed = (name || '').trim()
  if (trimmed.length < 1 || trimmed.length > 128) return false
  if (trimmed.includes('/') || trimmed.includes('\\')) return false
  return trimmed === basename(trimmed)
}

function _countDiffAddsDels(diff: string): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) adds++
    else if (line.startsWith('-')) dels++
  }
  return { adds, dels }
}

function mapCodexThread(thread: any): CodexThread {
  const gitInfo = thread?.gitInfo && typeof thread.gitInfo === 'object'
    ? { branch: safeString(thread.gitInfo.branch) || undefined }
    : null
  return {
    id: safeString(thread?.id),
    preview: safeString(thread?.preview),
    modelProvider: safeString(thread?.modelProvider) || undefined,
    createdAt: Number(thread?.createdAt ?? 0) || 0,
    updatedAt: Number(thread?.updatedAt ?? thread?.createdAt ?? 0) || 0, // SDK v0.87.0+
    cwd: safeString(thread?.cwd),
    cliVersion: safeString(thread?.cliVersion) || undefined,
    source: safeString(thread?.source) || undefined,
    gitInfo,
  }
}

function buildCodexTranscript(thread: any): CodexTranscriptMessage[] {
  const baseSec = Number(thread?.createdAt ?? 0) || Math.floor(Date.now() / 1000)
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const out: CodexTranscriptMessage[] = []
  let seq = 0
  let lastAssistant: CodexTranscriptMessage | null = null

  const push = (msg: CodexTranscriptMessage) => {
    out.push(msg)
    seq++
    if (msg.role === 'assistant') lastAssistant = msg
  }

  const ensureAssistant = (): CodexTranscriptMessage => {
    if (lastAssistant) return lastAssistant
    const msg: CodexTranscriptMessage = {
      id: `assistant_${baseSec}_${seq}`,
      role: 'assistant',
      createdAt: baseSec + seq,
      text: '',
      toolCalls: [],
      diffs: [],
    }
    push(msg)
    return msg
  }

  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : []
    for (const item of items) {
      const type = safeString(item?.type)
      const id = safeString(item?.id) || `item_${baseSec}_${seq}`

      if (type === 'userMessage') {
        const content = Array.isArray(item?.content) ? item.content : []
        const textParts: string[] = []
        for (const c of content) {
          if (safeString(c?.type) === 'text') {
            textParts.push(safeString(c?.text))
          }
        }
        push({
          id,
          role: 'user',
          createdAt: baseSec + seq,
          text: textParts.filter(Boolean).join('\n\n'),
        })
        continue
      }

      if (type === 'agentMessage') {
        push({
          id,
          role: 'assistant',
          createdAt: baseSec + seq,
          text: safeString(item?.text),
          toolCalls: [],
          diffs: [],
        })
        continue
      }

      if (type === 'reasoning') {
        const summary = Array.isArray(item?.summary) ? item.summary.map(safeString).join('\n') : ''
        const content = Array.isArray(item?.content) ? item.content.map(safeString).join('\n') : ''
        const thinking = [summary, content].filter((s) => s.trim().length > 0).join('\n')
        const a = ensureAssistant()
        a.thinking = `${(a.thinking ?? '').trim()}\n${thinking}`.trim()
        continue
      }

      const a = ensureAssistant()
      a.toolCalls = a.toolCalls ?? []
      a.diffs = a.diffs ?? []

      if (type === 'commandExecution') {
        // Apply head-tail truncation to preserve important start/end of long outputs
        const rawOutput = safeString(item?.aggregatedOutput)
        const truncated = rawOutput ? headTailTruncate(rawOutput, 50, 30) : null
        
        a.toolCalls.push({
          itemId: id,
          type: 'commandExecution',
          name: 'Bash',
          status: safeString(item?.status).toLowerCase() === 'completed'
            ? 'completed'
            : safeString(item?.status).toLowerCase() === 'failed'
              ? 'failed'
              : safeString(item?.status).toLowerCase() === 'declined'
                ? 'declined'
                : 'running',
          input: { command: safeString(item?.command), cwd: safeString(item?.cwd) },
          output: truncated?.text || undefined,
        })
        continue
      }

      if (type === 'fileChange') {
        const changes = Array.isArray(item?.changes) ? item.changes : []
        let unified = ''
        for (const ch of changes) {
          const d = safeString(ch?.diff)
          if (d) unified += `${d.trimEnd()}\n`
          const file = safeString(ch?.path)
          if (file && d) {
            const { adds, dels } = _countDiffAddsDels(d)
            a.diffs.push({ file, diff: d, additions: adds, deletions: dels, itemId: id })
          }
        }
        a.toolCalls.push({
          itemId: id,
          type: 'fileChange',
          name: 'ApplyPatch',
          status: safeString(item?.status).toLowerCase() === 'completed'
            ? 'completed'
            : safeString(item?.status).toLowerCase() === 'failed'
              ? 'failed'
              : safeString(item?.status).toLowerCase() === 'declined'
                ? 'declined'
                : 'running',
          input: { changes },
          output: unified.trim().length > 0 ? unified.trimEnd() : undefined,
        })
        continue
      }

      if (type === 'mcpToolCall') {
        a.toolCalls.push({
          itemId: id,
          type: 'mcpToolCall',
          name: `${safeString(item?.server)}.${safeString(item?.tool)}`.replaceAll(/^\./, ''),
          status: safeString(item?.status).toLowerCase() === 'completed'
            ? 'completed'
            : safeString(item?.status).toLowerCase() === 'failed'
              ? 'failed'
              : 'running',
          input: item?.arguments,
          output: item?.result ? JSON.stringify(item.result) : item?.error ? JSON.stringify(item.error) : undefined,
        })
        continue
      }

      if (type === 'webSearch') {
        a.toolCalls.push({
          itemId: id,
          type: 'webSearch',
          name: 'WebSearch',
          status: 'completed',
          input: { query: safeString(item?.query) },
        })
        continue
      }
    }
  }

  return out
}

// Security: Generate a random auth token
function generateAuthToken(): string {
  return randomBytes(24).toString('base64url')
}

// Load or create persistent auth token
export async function loadOrCreateAuthToken(forceNew = false): Promise<string> {
  if (!forceNew) {
    try {
      const existing = await readFile(TOKEN_FILE, 'utf-8')
      const token = existing.trim()
      if (token.length >= 16) {
        return token
      }
    } catch {
      // File doesn't exist or is unreadable - create new token
    }
  }

  const token = generateAuthToken()
  try {
    await mkdir(dirname(TOKEN_FILE), { recursive: true })
    await writeFile(TOKEN_FILE, token, { mode: 0o600 }) // Only owner can read/write
  } catch (err) {
    console.warn('Warning: Could not persist auth token:', err)
  }
  return token
}

// Security: Constant-time token comparison to prevent timing attacks
function validateAuthToken(provided: string, expected: string): boolean {
  try {
    const providedBuf = Buffer.from(provided)
    const expectedBuf = Buffer.from(expected)
    if (providedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(providedBuf, expectedBuf)
  } catch {
    return false
  }
}

const SECURITY_ALLOWED_BASE_PATHS = [
  homedir(),
  '/tmp',
  '/var/tmp',
]

function isSecureBasePath(realPath: string): boolean {
  return SECURITY_ALLOWED_BASE_PATHS.some((base) => realPath === base || realPath.startsWith(base + sep))
}

async function getSecurePath(requestedPath: string): Promise<string | null> {
  try {
    const expandedPath = requestedPath.startsWith('~')
      ? requestedPath.replace(/^~/, homedir())
      : requestedPath

    const abs = resolve(expandedPath)
    const rp = await realpath(abs).catch(() => null)
    if (!rp) return null

    return isSecureBasePath(rp) ? rp : null
  } catch {
    return null
  }
}

async function listFilesDirectly(
  filePath: string,
): Promise<Array<{ name: string; type: 'file' | 'directory'; path: string; absolute: string }>> {
  const securePath = await getSecurePath(filePath)
  if (!securePath) {
    console.error(`[listFilesDirectly] Access denied: ${filePath}`)
    return []
  }

  try {
    const entries = await readdir(securePath, { withFileTypes: true })
    const items: Array<{ name: string; type: 'file' | 'directory'; path: string; absolute: string }> = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const absolute = resolve(securePath, entry.name)
      items.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: absolute,
        absolute,
      })
    }

    // Sort: directories first, then files, alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return items
  } catch (error) {
    console.error(`[listFilesDirectly] Error listing ${securePath}:`, error)
    return []
  }
}

async function readFileDirectly(filePath: string): Promise<{ content: string; mime: string }> {
  const securePath = await getSecurePath(filePath)
  if (!securePath) {
    console.error(`[readFileDirectly] Access denied: ${filePath}`)
    return { content: '', mime: 'text/plain' }
  }

  try {
    const file = Bun.file(securePath)
    const exists = await file.exists()
    if (!exists) return { content: '', mime: 'text/plain' }

    const mime = file.type || 'application/octet-stream'
    const isText =
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('xml') ||
      mime.includes('javascript') ||
      mime.includes('typescript') ||
      mime.includes('markdown')

    if (!isText) {
      return { content: '', mime }
    }

    const text = await file.text()
    const maxChars = 1_000_000
    if (text.length > maxChars) {
      return { content: `${text.slice(0, maxChars)}\n\n…(truncated)…`, mime }
    }
    return { content: text, mime }
  } catch (error) {
    console.error(`[readFileDirectly] Error reading ${securePath}:`, error)
    return { content: '', mime: 'text/plain' }
  }
}

async function readFileBinaryDirectly(
  filePath: string,
  maxSizeMb: number = 10,
): Promise<{ base64: string; mime: string; size: number } | { error: 'not_found' | 'too_large' | 'access_denied'; size?: number }> {
  const securePath = await getSecurePath(filePath)
  if (!securePath) {
    console.error(`[readFileBinaryDirectly] Access denied: ${filePath}`)
    return { error: 'access_denied' }
  }

  try {
    const file = Bun.file(securePath)
    const exists = await file.exists()
    if (!exists) return { error: 'not_found' }

    const size = file.size
    const maxBytes = maxSizeMb * 1024 * 1024
    if (size > maxBytes) {
      return { error: 'too_large', size }
    }

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mime = file.type || 'application/octet-stream'

    return { base64, mime, size }
  } catch (error) {
    console.error(`[readFileBinaryDirectly] Error reading ${securePath}:`, error)
    return { error: 'not_found' }
  }
}

export type BridgeServerOptions = {
  port: number
  opencode: OpenCodeConnector
  currentAgent?: AgentType
  version: string
  authToken?: string
  restartOpenCode?: () => Promise<boolean>
  logger?: (message: string) => void
}

export type BridgeServer = {
  broadcast: (message: ServerMessage) => void
  enqueueSdkEvent: (event: unknown) => void
  stop: (force?: boolean) => void
  connections: () => number
  port: () => number
  authToken: () => string
}

type ConnectionContext = {
  projectPath?: string
  sessionId?: string
  viewAgent?: AgentType
  lastPongAt: number
  lastRttMs: number
  pendingPing?: { id: string; sentAt: number }
  connectionType: 'local' | 'tailscale' | 'unknown'
  deviceId?: string
  deviceName?: string
  platform?: string
  connectedAt: number
}

type ClientQueue = {
  queue: unknown[]
  timer: Timer | null
}

const BATCH_THRESHOLDS = {
  local: { low: 16, high: 8, burst: 4 },
  tailscale: { low: 32, high: 16, burst: 8 },
  highLatency: { low: 50, high: 25, burst: 12 },
}

const MESSAGE_PRIORITIES: Record<string, 'immediate' | 'high' | 'normal' | 'low'> = {
  'permission.updated': 'immediate',
  'permission.asked': 'immediate',
  'permission.replied': 'immediate',
  'question.asked': 'immediate',
  'question.replied': 'immediate',
  'question.rejected': 'immediate',
  'session.error': 'immediate',
  'session.idle': 'high',
  'message.part.updated': 'high',
  'message.updated': 'normal',
  'session.diff': 'normal',
  'todo.updated': 'normal',
  'file.watcher.updated': 'low',
  'lsp.updated': 'low',
}

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const sockets = new Set<ServerWebSocket<unknown>>()
  const contexts = new Map<ServerWebSocket<unknown>, ConnectionContext>()
  const clientQueues = new Map<ServerWebSocket<unknown>, ClientQueue>()
  // Dedupe chat prompts (prevents resend storms on flaky networks).
  const recentChatMessageIds = new Map<string, number>() // key: `${sessionId}:${messageId}` -> tsMs
  const ptyConnections = new Map<string, WebSocket>()
  const ptyListeners = new Map<string, Set<ServerWebSocket<unknown>>>()
  const ptyOutputBuffers = new Map<string, { buffer: string; timer: Timer | null }>()
  const ptyHealth = new Map<
    string,
    { lastInputTime: number; lastOutputTime: number; bytesIn: number; bytesOut: number }
  >()
  const sessionWatchers = new Map<string, Set<ServerWebSocket<unknown>>>()
  const ccExternalTails = new Map<string, { stop: () => void }>() // sessionId -> tailer
  const cxExternalTails = new Map<string, { stop: () => void }>() // threadId -> tailer
  const ocExternalTails = new Map<string, { stop: () => void }>() // sessionId -> tailer (OpenCode)
  const ocSessionProjectPaths = new Map<string, string>() // sessionId -> projectPath (for external tail)
  const ccPermissionWaiters = new Map<
    string,
    { resolve: (response: 'once' | 'always' | 'reject') => void; timer: Timer }
  >()
  type CodexApprovalReply = { response: PermissionResponse; execpolicyAmendment?: any }
  const cxApprovalWaiters = new Map<
    string,
    { resolve: (response: CodexApprovalReply) => void; timer: Timer }
  >()
  const ccSessionOwners = new Map<string, ServerWebSocket<unknown>>()
  const cxThreadOwners = new Map<string, ServerWebSocket<unknown>>()
  const cxActiveTurns = new Map<string, string>()
  const cxItemCache = new Map<string, any>() // key: `${threadId}:${turnId}:${itemId}` -> item
  const cxThreadCwds = new Map<string, string>() // threadId -> absolute cwd
  const cxFileChangeSnapshots = new Map<string, string>() // `${threadId}:${turnId}:${itemId}` -> manifestPath
  const cxUndoStackByThread = new Map<string, string[]>() // threadId -> snapshot keys (LIFO)
  
  // Codex session-scoped approval cache: remembers "accept for session" decisions
  // Key format: `${threadId}:${method}:${argsHash}` -> 'approved'
  const cxApprovalCache = new Map<string, 'approved'>()

  // Codex caching for fast session/project loading (mirrors OpenCode's 5s TTL pattern)
  // Project cache has longer TTL since projects rarely change
  const CODEX_THREAD_CACHE_TTL_MS = 5000 // 5 seconds
  const CODEX_PROJECT_CACHE_TTL_MS = 30000 // 30 seconds
  type CxThreadCacheEntry = { data: any[]; fetchedAt: number; nextCursor: string | null }
  type CxProjectCacheEntry = { data: any[]; fetchedAt: number }
  const cxThreadCache = new Map<string, CxThreadCacheEntry>() // key: cwd or '__all__' -> threads
  let cxProjectCache: CxProjectCacheEntry | null = null
  
  /** Invalidate Codex caches (called on mutations) */
  const invalidateCodexCaches = (cwd?: string) => {
    // Always invalidate project cache on any mutation
    cxProjectCache = null
    // Invalidate thread caches
    if (cwd) {
      cxThreadCache.delete(cwd)
      cxThreadCache.delete(resolve(cwd))
    }
    cxThreadCache.delete('__all__')
  }

  /** Generate a stable cache key for approval caching */
  const makeCxApprovalKey = (threadId: string, method: string, params: any): string => {
    // Extract the command/tool-specific parts for the cache key
    let argsForKey: string
    if (method === 'item/commandExecution/requestApproval') {
      // For command approvals, use the command string
      argsForKey = safeString(params?.command ?? params?.item?.command ?? '')
    } else if (method === 'item/fileChange/requestApproval') {
      // For file change approvals, use the file paths
      const changes = Array.isArray(params?.changes) ? params.changes : []
      argsForKey = changes.map((c: any) => safeString(c?.path)).sort().join('|')
    } else {
      // For other approvals, use stringified params
      try {
        argsForKey = JSON.stringify(params, Object.keys(params ?? {}).sort())
      } catch {
        argsForKey = ''
      }
    }
    // Create a simple hash for the key
    let hash = 0
    for (let i = 0; i < argsForKey.length; i++) {
      hash = ((hash << 5) - hash + argsForKey.charCodeAt(i)) | 0
    }
    return `${threadId}:${method}:${hash}`
  }
  
  let codexClient: CodexAppServerClient | null = null
  const { opencode, version, logger } = options
  
  let currentAgent: AgentType = options.currentAgent || 'opencode'
  const lastGitBranchByProject = new Map<string, string>()
  
  const authToken = options.authToken || generateAuthToken()

  // Claude Code filesystem watchers (skills/plugins/hook/command updates).
  const ccFsWatchers = new Map<string, { watcher: FSWatcher; debounce: Timer | null; kind: 'skills' | 'plugins' | 'hooks' | 'commands' | 'mcp'; cwd?: string }>()
  const ensureClaudeWatchDir = (
    dir: string,
    kind: 'skills' | 'plugins' | 'hooks' | 'commands' | 'mcp',
    cwd?: string,
    recursive = true,
  ) => {
    if (!dir || ccFsWatchers.has(dir)) return

    try {
      const watcher = fsWatch(dir, { persistent: false, recursive }, (_eventType, filename) => {
        const existing = ccFsWatchers.get(dir)
        if (!existing) return
        if (existing.debounce) clearTimeout(existing.debounce)
        existing.debounce = setTimeout(() => {
          existing.debounce = null
          broadcast({
            type: 'cc_fs_changed',
            data: {
              kind,
              dir,
              ...(cwd ? { cwd } : {}),
              ...(filename ? { file: String(filename) } : {}),
            },
          })
        }, 150)
      })

      ccFsWatchers.set(dir, { watcher, debounce: null, kind, cwd })
    } catch {
      // Ignore watch failures (dir missing or unsupported)
    }
  }


  // Load artifacts config (async, best-effort) - only if enabled
  // TODO(artifacts): Re-enable when feature is ready
  let artifactsEnrichment: (typeof import('./artifacts/enrichment')) | null = null
  if (ARTIFACTS_ENABLED) {
    void initArtifactsIfEnabled()
      .then(() => getArtifactsConfig?.())
      .then((cfg) => cfg && artifactIndex?.applyConfig(cfg))
      .catch((err) => console.warn('[Artifacts] Failed to load config:', err))
  
    // Configure enrichment worker (async, best-effort)
    void import('./artifacts/enrichment')
      .then((m) => {
        artifactsEnrichment = m
        m.configureArtifactsEnrichment({
          opencodeConnector: opencode,
          getCurrentAgent: () => currentAgent,
        onEnrichmentEvent: (evt) => {
          broadcast({ type: 'artifacts_enrichment', data: evt })
        },
      })
    })
    .catch((err) => console.warn('[Artifacts] Failed to init enrichment worker:', err))
  } // End of ARTIFACTS_ENABLED block

  const log = (message: string) => {
    logger?.(message)
  }

  const send = (ws: ServerWebSocket<unknown>, message: ServerMessage) => {
    ws.send(JSON.stringify(message))
  }

  const broadcast = (message: ServerMessage) => {
    const payload = JSON.stringify(message)
    for (const ws of sockets) {
      ws.send(payload)
    }
  }

  const getPtyListeners = (ptyId: string) => {
    const existing = ptyListeners.get(ptyId)
    if (existing) return existing
    const created = new Set<ServerWebSocket<unknown>>()
    ptyListeners.set(ptyId, created)
    return created
  }

  const ensurePtyBuffer = (ptyId: string) => {
    const existing = ptyOutputBuffers.get(ptyId)
    if (existing) return existing
    const created = { buffer: '', timer: null as Timer | null }
    ptyOutputBuffers.set(ptyId, created)
    return created
  }

  const ensurePtyHealth = (ptyId: string) => {
    const existing = ptyHealth.get(ptyId)
    if (existing) return existing
    const now = Date.now()
    const created = { lastInputTime: now, lastOutputTime: now, bytesIn: 0, bytesOut: 0 }
    ptyHealth.set(ptyId, created)
    return created
  }

  const flushPtyOutput = (ptyId: string) => {
    const state = ptyOutputBuffers.get(ptyId)
    if (!state || state.buffer.length === 0) {
      if (state) state.timer = null
      return
    }

    const data = state.buffer
    state.buffer = ''
    state.timer = null

    const listeners = ptyListeners.get(ptyId)
    if (!listeners || listeners.size === 0) return
    for (const client of listeners) {
      send(client, { type: 'pty_output', ptyId, data })
    }
  }

  const closePtyIfNoListeners = (ptyId: string) => {
    const listeners = ptyListeners.get(ptyId)
    if (listeners && listeners.size > 0) return

    const buf = ptyOutputBuffers.get(ptyId)
    if (buf?.timer) clearTimeout(buf.timer)
    ptyOutputBuffers.delete(ptyId)
    ptyHealth.delete(ptyId)
    ptyListeners.delete(ptyId)

    const ptyWs = ptyConnections.get(ptyId)
    if (ptyWs) {
      try {
        ptyWs.close()
      } catch {}
      ptyConnections.delete(ptyId)
    }
  }

  // Periodic PTY health snapshots (best-effort; cheap + optional UI)
  setInterval(() => {
    const now = Date.now()
    for (const [ptyId, health] of ptyHealth.entries()) {
      const listeners = ptyListeners.get(ptyId)
      if (!listeners || listeners.size === 0) continue
      const isResponsive = now - health.lastOutputTime < 5000
      for (const client of listeners) {
        send(client, {
          type: 'pty_health',
          ptyId,
          lastInputTime: health.lastInputTime,
          lastOutputTime: health.lastOutputTime,
          bytesIn: health.bytesIn,
          bytesOut: health.bytesOut,
          isResponsive,
        })
      }
    }
  }, 1000)

  // Watch user-scope Claude Code skills (best-effort).
  ensureClaudeWatchDir(join(homedir(), '.claude', 'skills'), 'skills')

  const ensureUndoStack = (threadId: string) => {
    const existing = cxUndoStackByThread.get(threadId)
    if (existing) return existing
    const created: string[] = []
    cxUndoStackByThread.set(threadId, created)
    return created
  }

  const safeResolveInCwd = (cwd: string, relativePath: string): string => {
    const abs = resolve(cwd, relativePath)
    const normalizedCwd = cwd.endsWith(sep) ? cwd : `${cwd}${sep}`
    if (abs === cwd || abs.startsWith(normalizedCwd)) return abs
    return resolve(cwd, relativePath.replace(/^\/*/, ''))
  }

  type FileSnapshotEntry = {
    path: string
    kind: 'add' | 'delete' | 'update'
    movePath?: string | null
    existed: boolean
    contentFile?: string | null
    targetExisted?: boolean
    targetContentFile?: string | null
  }

  const snapshotCodexFileChange = async (
    threadId: string,
    turnId: string,
    itemId: string,
    item: any,
  ): Promise<void> => {
    const cwd = cxThreadCwds.get(threadId)
    if (!cwd) return
    const changes = Array.isArray(item?.changes) ? item.changes : []
    if (changes.length === 0) return

    const baseDir = resolve(cwd, '.broski', 'codex-undo', threadId, turnId, itemId)
    const filesDir = resolve(baseDir, 'files')
    await mkdir(filesDir, { recursive: true })

    const entries: FileSnapshotEntry[] = []
    let idx = 0

    for (const c of changes) {
      const relPath = safeString(c?.path)
      const kindObj = c?.kind
      const kindType = safeString(kindObj?.type).toLowerCase()
      const kind: FileSnapshotEntry['kind'] =
        kindType === 'add' ? 'add' : kindType === 'delete' ? 'delete' : 'update'
      const movePathRaw = safeString(kindObj?.movePath)
      const movePath = movePathRaw ? movePathRaw : null

      const absPath = safeResolveInCwd(cwd, relPath)
      let existed = false
      let contentFile: string | null = null
      try {
        await stat(absPath)
        existed = true
        const buf = await readFile(absPath)
        const name = `orig_${idx}.bin`
        await writeFile(resolve(filesDir, name), buf)
        contentFile = name
      } catch {
        existed = false
      }

      let targetExisted: boolean | undefined
      let targetContentFile: string | null = null
      if (movePath) {
        const targetAbs = safeResolveInCwd(cwd, movePath)
        try {
          await stat(targetAbs)
          targetExisted = true
          const buf = await readFile(targetAbs)
          const name = `target_${idx}.bin`
          await writeFile(resolve(filesDir, name), buf)
          targetContentFile = name
        } catch {
          targetExisted = false
        }
      }

      entries.push({
        path: relPath,
        kind,
        movePath,
        existed,
        contentFile,
        ...(movePath ? { targetExisted, targetContentFile } : {}),
      })
      idx++
    }

    const manifest = {
      threadId,
      turnId,
      itemId,
      cwd,
      createdAt: Math.floor(Date.now() / 1000),
      entries,
    }
    const manifestPath = resolve(baseDir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const key = `${threadId}:${turnId}:${itemId}`
    cxFileChangeSnapshots.set(key, manifestPath)
  }

  const applyCodexUndo = async (threadId: string, key: string): Promise<string[]> => {
    const manifestPath = cxFileChangeSnapshots.get(key)
    if (!manifestPath) return []
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as { cwd: string; entries: FileSnapshotEntry[] }
    const cwd = parsed.cwd
    const reverted: string[] = []
    const filesDir = resolve(dirname(manifestPath), 'files')

    const restoreFile = async (
      rel: string,
      existed: boolean,
      contentFile?: string | null,
    ) => {
      const abs = safeResolveInCwd(cwd, rel)
      if (!existed) {
        await rm(abs, { force: true })
        reverted.push(rel)
        return
      }
      if (!contentFile) return
      const buf = await readFile(resolve(filesDir, contentFile))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, buf)
      reverted.push(rel)
    }

    for (const e of parsed.entries) {
      if (e.kind === 'update' && e.movePath) {
        await restoreFile(e.movePath, e.targetExisted === true, e.targetContentFile)
        await restoreFile(e.path, e.existed, e.contentFile)
      } else {
        await restoreFile(e.path, e.existed, e.contentFile)
      }
    }

    const stack = ensureUndoStack(threadId)
    const idx = stack.lastIndexOf(key)
    if (idx >= 0) stack.splice(idx, 1)
    cxFileChangeSnapshots.delete(key)
    return reverted
  }

  const ensureCodexClient = async () => {
    if (!codexClient) {
      codexClient = new CodexAppServerClient()
      codexClient.setHandlers({
        onNotification: (n) => {
          const params: any = n.params ?? {}
          const threadId = safeString(params.threadId ?? params.thread_id ?? params.threadID)
          const turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID)

          if (n.method === 'thread/started') {
            const thread = params.thread
            const id = safeString(thread?.id)
            const cwd = safeString(thread?.cwd)
            if (id && cwd) cxThreadCwds.set(id, resolve(cwd))
          }

          // Cache items for approval requests
          if (n.method === 'item/started' || n.method === 'item/completed') {
            const item = params.item
            const itemId = safeString(item?.id)
            if (threadId && turnId && itemId) {
              cxItemCache.set(`${threadId}:${turnId}:${itemId}`, item)
              if (safeString(item?.type) === 'fileChange' && n.method === 'item/started') {
                void snapshotCodexFileChange(threadId, turnId, itemId, item).catch(() => {})
              }
              if (safeString(item?.type) === 'fileChange' && n.method === 'item/completed') {
                const status = safeString(item?.status).toLowerCase()
                const key = `${threadId}:${turnId}:${itemId}`
                if (status.includes('completed') && cxFileChangeSnapshots.has(key)) {
                  ensureUndoStack(threadId).push(key)
                } else {
                  cxFileChangeSnapshots.delete(key)
                }
              }
            }
          }

          // Track latest running turn for abort
          if (n.method === 'turn/started') {
            const tid = safeString(params.turn?.id)
            if (threadId && tid) cxActiveTurns.set(threadId, tid)
          }
          if (n.method === 'turn/completed') {
            const tid = safeString(params.turn?.id)
            if (threadId && tid && cxActiveTurns.get(threadId) === tid) {
              cxActiveTurns.delete(threadId)
            }
          }

          // Multi-Agent Collaboration Events (Codex SDK v0.87.0+)
          // Map collab notifications to specialized event types for UI rendering
          if (n.method.startsWith('collab/')) {
            const collabMethod = n.method.replace('collab/', '').replace('/', '_')
            const collabData = {
              callId: safeString(params.call_id ?? params.callId),
              senderThreadId: safeString(params.sender_thread_id ?? params.senderThreadId ?? threadId),
              receiverThreadId: safeString(params.receiver_thread_id ?? params.receiverThreadId),
              receiverThreadIds: Array.isArray(params.receiver_thread_ids ?? params.receiverThreadIds)
                ? (params.receiver_thread_ids ?? params.receiverThreadIds).map(safeString)
                : [],
              newThreadId: safeString(params.new_thread_id ?? params.newThreadId) || undefined,
              prompt: safeString(params.prompt),
              status: params.status,
              statuses: params.statuses,
            }
            const senderThread = collabData.senderThreadId || threadId
            const owner = senderThread ? cxThreadOwners.get(senderThread) : null
            emitCxStream(senderThread || threadId, { type: `collab_${collabMethod}` as any, data: collabData }, owner)
            return
          }

          const owner = threadId ? cxThreadOwners.get(threadId) : null
          if (!threadId) {
            // Some notifications are global (no threadId): auth, rate limits, MCP oauth completion, etc.
            for (const ws of sockets) {
              send(ws, { type: 'cx_global', data: { method: n.method, params } })
            }
            return
          }

          emitCxStream(threadId, { type: 'notification', method: n.method, params }, owner)

          // Send busy/idle events for background indicators/notifications
          if (owner && n.method === 'turn/started' && threadId) {
            send(owner, {
              type: 'sdk_event',
              data: {
                payload: {
                  type: 'session.status',
                  properties: { sessionID: threadId, status: { type: 'busy' } },
                },
              },
            })
          }
          if (owner && n.method === 'turn/completed' && threadId) {
            send(owner, {
              type: 'sdk_event',
              data: {
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: threadId },
                },
              },
            })
          }
        },
        onServerRequest: async (r) => {
          const params: any = r.params ?? {}
          const threadId = safeString(params.threadId ?? params.thread_id ?? params.threadID)
          const turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID)
          const itemId = safeString(params.itemId ?? params.item_id ?? params.itemID)
          const owner = threadId ? cxThreadOwners.get(threadId) : null

          if (!owner) {
            return { decision: 'decline' }
          }

          // Check approval cache for "accept for session" decisions
          const approvalCacheKey = makeCxApprovalKey(threadId, r.method, params)
          if (cxApprovalCache.has(approvalCacheKey)) {
            // Already approved for this session, skip prompting
            return { decision: 'acceptForSession' }
          }

          const cached = threadId && turnId && itemId
            ? cxItemCache.get(`${threadId}:${turnId}:${itemId}`)
            : null

          send(owner, {
            type: 'cx_stream',
            threadId,
            data: {
              type: 'request',
              requestId: String(r.id),
              method: r.method,
              params: { ...params, cachedItem: cached },
            } satisfies CodexStreamMessage,
          })

          const response = await new Promise<CodexApprovalReply>((resolve) => {
            const key = String(r.id)
            const timer = setTimeout(() => {
              cxApprovalWaiters.delete(key)
              resolve({ response: 'reject' })
            }, 120_000)
            cxApprovalWaiters.set(key, { resolve, timer })
          })

          // Handle request_user_input (Codex SDK v0.87.0+)
          // This returns answers in a different format than approval requests
          const isUserInput = r.method === 'item/tool/requestUserInput'
          if (isUserInput && (response as any).answers) {
            return { answers: (response as any).answers }
          }

          const isCommand = r.method === 'item/commandExecution/requestApproval'
          if (isCommand && response.response === 'execpolicy' && response.execpolicyAmendment) {
            return {
              decision: {
                acceptWithExecpolicyAmendment: {
                  execpolicyAmendment: response.execpolicyAmendment,
                },
              },
            }
          }

          const decision =
            response.response === 'always'
              ? 'acceptForSession'
              : response.response === 'once'
                ? 'accept'
                : 'decline'

          // Cache "accept for session" decisions to avoid re-prompting
          if (decision === 'acceptForSession') {
            cxApprovalCache.set(approvalCacheKey, 'approved')
          }

          return { decision }
        },
      })
    }

    await codexClient.start()
    return codexClient
  }

  const getDeviceInfo = (ws: ServerWebSocket<unknown>): DeviceInfo | null => {
    const ctx = contexts.get(ws)
    if (!ctx || !ctx.deviceId) return null
    return {
      deviceId: ctx.deviceId,
      deviceName: ctx.deviceName ?? 'Unknown Device',
      platform: ctx.platform ?? 'unknown',
      connectionType: ctx.connectionType,
      rttMs: ctx.lastRttMs,
      connectedAt: ctx.connectedAt,
      currentView: ctx.projectPath || ctx.sessionId
        ? { projectPath: ctx.projectPath, sessionId: ctx.sessionId }
        : undefined,
    }
  }

  const getAllDevices = (): DeviceInfo[] => {
    const devices: DeviceInfo[] = []
    for (const ws of sockets) {
      const device = getDeviceInfo(ws)
      if (device) devices.push(device)
    }
    return devices
  }

  const findSocketByDeviceId = (deviceId: string): ServerWebSocket<unknown> | null => {
    for (const ws of sockets) {
      const ctx = contexts.get(ws)
      if (ctx?.deviceId === deviceId) return ws
    }
    return null
  }

  const makeSessionKey = (agent: AgentType | undefined, sessionId: string | undefined): string | null => {
    if (!agent || !sessionId) return null
    return `${agent}:${sessionId}`
  }

  const parseSessionKey = (key: string): { agent: AgentType; id: string } | null => {
    const idx = key.indexOf(':')
    if (idx <= 0) return null
    const agent = key.slice(0, idx) as AgentType
    const id = key.slice(idx + 1)
    if (!id) return null
    return { agent, id }
  }

  const stopCcExternalTail = (sessionId: string) => {
    const existing = ccExternalTails.get(sessionId)
    if (!existing) return
    try {
      existing.stop()
    } catch {
      // ignore
    }
    ccExternalTails.delete(sessionId)
  }

  const stopCxExternalTail = (threadId: string) => {
    const existing = cxExternalTails.get(threadId)
    if (!existing) return
    try {
      existing.stop()
    } catch {
      // ignore
    }
    cxExternalTails.delete(threadId)
  }

  const stopOcExternalTail = (sessionId: string) => {
    const existing = ocExternalTails.get(sessionId)
    if (!existing) return
    try {
      existing.stop()
    } catch {
      // ignore
    }
    ocExternalTails.delete(sessionId)
  }

  /**
   * OpenCode External Tail: Polls session messages to detect changes from external TUI sessions.
   * When the TUI runs, events don't reach global.event() stream, so we poll the API instead.
   */
  const startOpenCodeExternalTail = (sessionId: string, projectPath: string): { stop: () => void } => {
    let stopped = false
    let pollTimer: Timer | null = null
    let initialSyncDone = false // Skip emitting events on first poll (historical messages)
    const lastTextByPartId = new Map<string, string>()
    const lastToolStateByPartId = new Map<string, string>()
    const seenMessageIds = new Set<string>()
    const seenPartIds = new Set<string>()
    let lastSessionStatus: 'idle' | 'busy' | 'retry' = 'idle'
    let lastEmittedStatus: 'idle' | 'busy' = 'idle' // What we last told the app (based on content changes, not API)
    let idleCount = 0 // Track consecutive idle polls for adaptive polling
    let lastChangeTime = Date.now() // Track when we last detected content changes
    let wasEverBusy = false // Track if we've ever seen activity (to avoid false idle on startup)

    const poll = async () => {
      if (stopped) return
      try {
        // Get session status
        const statusMap = await opencode.getSessionStatus(projectPath).catch(() => ({}))
        const status = statusMap[sessionId]
        const newStatus = status?.type ?? 'idle'
        
        // Debug: Log raw status response on first few polls or when it changes
        if (DEBUG_RTS && (idleCount < 3 || newStatus !== lastSessionStatus)) {
          const sessionIds = Object.keys(statusMap)
          console.log(`[RTS] OC External: getSessionStatus returned ${sessionIds.length} sessions: ${sessionIds.join(', ') || '(none)'}`)
          if (status) {
            console.log(`[RTS] OC External: Session ${sessionId} raw status: ${JSON.stringify(status)}`)
          } else {
            console.log(`[RTS] OC External: Session ${sessionId} NOT in status map, defaulting to idle`)
          }
        }
        
        // Track idle state for adaptive polling
        if (newStatus === 'idle') {
          idleCount++
        } else {
          idleCount = 0
        }
        
        if (newStatus !== lastSessionStatus) {
          if (DEBUG_RTS) {
            console.log(`[RTS] OC External: Session ${sessionId} status changed: ${lastSessionStatus} -> ${newStatus}`)
          }
          lastSessionStatus = newStatus
          
          // Always emit session status events (important for UI state)
          enqueueSdkEvent({
            directory: projectPath,
            payload: {
              type: 'session.status',
              properties: {
                sessionID: sessionId,
                status: { type: newStatus },
              },
            },
          })
        }

        // Get session messages
        const messages = await opencode.getSessionMessages(sessionId, projectPath).catch(() => null)
        if (!messages || !Array.isArray(messages)) return

        let hadChanges = false

        for (const msg of messages) {
          if (!msg?.info?.id) continue
          const msgId = msg.info.id
          const isNewMessage = !seenMessageIds.has(msgId)
          
          if (isNewMessage) {
            seenMessageIds.add(msgId)
            
            // Only emit events AFTER initial sync
            if (initialSyncDone) {
              hadChanges = true
              if (DEBUG_RTS) {
                console.log(`[RTS] OC External: New message ${msgId} in session ${sessionId}`)
              }
              
              enqueueSdkEvent({
                directory: projectPath,
                payload: {
                  type: 'message.updated',
                  properties: {
                    info: {
                      ...msg.info,
                      sessionID: sessionId,
                    },
                  },
                },
              })
            }
          }

          // Check parts for updates
          const parts = Array.isArray(msg.parts) ? msg.parts : []
          for (const part of parts) {
            if (!part?.id) continue
            const partId = part.id
            const isNewPart = !seenPartIds.has(partId)
            
            // For text parts, check for content changes
            if (part.type === 'text' && typeof part.text === 'string') {
              const prevText = lastTextByPartId.get(partId) ?? ''
              const textChanged = part.text !== prevText
              
              if (textChanged) {
                lastTextByPartId.set(partId, part.text)
                
                // Only emit events AFTER initial sync
                if (initialSyncDone) {
                  hadChanges = true
                  // Emit part update with delta if possible
                  const delta = prevText && part.text.startsWith(prevText) 
                    ? part.text.slice(prevText.length) 
                    : undefined
                  
                  if (DEBUG_RTS) {
                    console.log(`[RTS] OC External: Text part ${partId} updated, delta=${delta?.length ?? 'full'}`)
                  }
                  
                  enqueueSdkEvent({
                    directory: projectPath,
                    payload: {
                      type: 'message.part.updated',
                      properties: {
                        part: {
                          ...part,
                          sessionID: sessionId,
                          messageID: msgId,
                        },
                        delta,
                      },
                    },
                  })
                }
              }
            }
            
            // For tool parts, check for state changes
            if (part.type === 'tool' && part.state) {
              const stateKey = `${part.state.status}:${JSON.stringify(part.state.output ?? '')}`
              const prevState = lastToolStateByPartId.get(partId)
              const stateChanged = stateKey !== prevState
              
              if (stateChanged) {
                lastToolStateByPartId.set(partId, stateKey)
                
                // Only emit events AFTER initial sync
                if (initialSyncDone) {
                  hadChanges = true
                  if (DEBUG_RTS) {
                    console.log(`[RTS] OC External: Tool part ${partId} state changed to ${part.state.status}`)
                  }
                  
                  enqueueSdkEvent({
                    directory: projectPath,
                    payload: {
                      type: 'message.part.updated',
                      properties: {
                        part: {
                          ...part,
                          sessionID: sessionId,
                          messageID: msgId,
                        },
                      },
                    },
                  })
                }
              }
            }
            
            // Track new parts
            if (isNewPart) {
              seenPartIds.add(partId)
              
              // Only emit events AFTER initial sync, and for non-text parts (text handled above)
              if (initialSyncDone && part.type !== 'text') {
                hadChanges = true
                enqueueSdkEvent({
                  directory: projectPath,
                  payload: {
                    type: 'message.part.updated',
                    properties: {
                      part: {
                        ...part,
                        sessionID: sessionId,
                        messageID: msgId,
                      },
                    },
                  },
                })
              }
            }
          }
        }

        // Mark initial sync as done after first poll
        if (!initialSyncDone) {
          initialSyncDone = true
          if (DEBUG_RTS) {
            console.log(`[RTS] OC External: Initial sync complete for session ${sessionId}, ${seenMessageIds.size} messages, ${seenPartIds.size} parts`)
          }
        }

        // Track when we last had changes for idle detection
        if (hadChanges) {
          idleCount = 0
          lastChangeTime = Date.now()
          
          // Mark as busy when we see content changes (since API doesn't report status)
          if (!wasEverBusy || lastEmittedStatus !== 'busy') {
            wasEverBusy = true
            lastEmittedStatus = 'busy'
            if (DEBUG_RTS) {
              console.log(`[RTS] OC External: Content changes detected, emitting busy status`)
            }
            enqueueSdkEvent({
              directory: projectPath,
              payload: {
                type: 'session.status',
                properties: {
                  sessionID: sessionId,
                  status: { type: 'busy' },
                },
              },
            })
          }
        }
        
        // Fallback idle detection: if we had changes before but none for 1.5 seconds, emit idle
        // This is needed because getSessionStatus returns 0 sessions (doesn't track external sessions)
        const timeSinceLastChange = Date.now() - lastChangeTime
        if (wasEverBusy && lastEmittedStatus === 'busy' && timeSinceLastChange > 1500 && !hadChanges) {
          if (DEBUG_RTS) {
            console.log(`[RTS] OC External: Fallback idle detection - no changes for ${timeSinceLastChange}ms, emitting idle status`)
          }
          lastEmittedStatus = 'idle'
          enqueueSdkEvent({
            directory: projectPath,
            payload: {
              type: 'session.status',
              properties: {
                sessionID: sessionId,
                status: { type: 'idle' },
              },
            },
          })
        }
      } catch (err) {
        if (DEBUG_RTS) {
          console.log(`[RTS] OC External: Poll error for session ${sessionId}:`, err)
        }
      }
    }

    // Adaptive polling: faster when busy, slower when idle
    const scheduleNextPoll = () => {
      if (stopped) return
      // 150ms when active, up to 2000ms when idle for 10+ consecutive polls
      const interval = idleCount > 10 ? 2000 : idleCount > 5 ? 1000 : 150
      pollTimer = setTimeout(() => {
        void poll().then(scheduleNextPoll)
      }, interval)
    }

    // Do initial poll, then start adaptive polling
    void poll().then(scheduleNextPoll)

    if (DEBUG_RTS) {
      console.log(`[RTS] OC External: Started polling for session ${sessionId} in ${projectPath}`)
    }

    return {
      stop: () => {
        stopped = true
        if (pollTimer) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
        if (DEBUG_RTS) {
          console.log(`[RTS] OC External: Stopped polling for session ${sessionId}`)
        }
      },
    }
  }

  const startClaudeCodeExternalTail = (sessionId: string): { stop: () => void } => {
    let stopped = false
    let filePath: string | null = null
    let fileHandle: any | null = null
    let offset = 0
    let buffer = ''
    let watcher: FSWatcher | null = null
    let dirWatcher: FSWatcher | null = null
    let pollTimer: Timer | null = null
    let pumping = false
    let lastMtimeMs = 0
    let lastIno = 0
    let initialSyncDone = false // Skip emitting events until first pump completes (builds baseline)
    const lastTextByMessageId = new Map<string, string>()
    const lastThinkingByMessageId = new Map<string, string>()
    const emittedToolCalls = new Set<string>() // Track emitted tool calls to avoid duplicates

    const extractText = (content: unknown): string => {
      if (typeof content === 'string') return content
      if (!Array.isArray(content)) return ''
      const parts: string[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        if ((block as any).type === 'text' && typeof (block as any).text === 'string') {
          parts.push((block as any).text)
        }
      }
      return parts.join('')
    }
    
    const extractThinking = (content: unknown): string => {
      if (!Array.isArray(content)) return ''
      const parts: string[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        if ((block as any).type === 'thinking' && typeof (block as any).thinking === 'string') {
          parts.push((block as any).thinking)
        }
      }
      return parts.join('')
    }
    
    type ToolUseBlock = {
      id: string
      name: string
      input: any
    }
    
    const extractToolUseBlocks = (content: unknown): ToolUseBlock[] => {
      if (!Array.isArray(content)) return []
      const tools: ToolUseBlock[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        if ((block as any).type === 'tool_use') {
          tools.push({
            id: safeString((block as any).id),
            name: safeString((block as any).name),
            input: (block as any).input,
          })
        }
      }
      return tools
    }
    
    type ToolResultBlock = {
      toolUseId: string
      content: string
      isError?: boolean
    }
    
    const extractToolResults = (content: unknown): ToolResultBlock[] => {
      if (!Array.isArray(content)) return []
      const results: ToolResultBlock[] = []
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        if ((block as any).type === 'tool_result') {
          let resultContent = ''
          const c = (block as any).content
          if (typeof c === 'string') {
            resultContent = c
          } else if (Array.isArray(c)) {
            for (const part of c) {
              if (part?.type === 'text' && typeof part?.text === 'string') {
                resultContent += part.text
              }
            }
          }
          results.push({
            toolUseId: safeString((block as any).tool_use_id),
            content: resultContent,
            isError: (block as any).is_error === true,
          })
        }
      }
      return results
    }

    const bootstrapBaseline = async (path: string) => {
      // Reads ALL existing records to build baseline state for text, thinking, and tool calls.
      // This prevents re-emitting historical events when the external tail starts.
      try {
        const st = await stat(path)
        const end = Number(st.size ?? 0)
        if (!Number.isFinite(end) || end <= 0) return
        const maxBytes = 400_000 // Increased to capture more history
        const start = Math.max(0, end - maxBytes)
        const fh = await open(path, 'r')
        try {
          const len = end - start
          const buf = Buffer.alloc(len)
          const res = await fh.read(buf, 0, len, start)
          const txt = buf.subarray(0, res.bytesRead).toString('utf-8')
          const lines = txt.split('\n').filter(Boolean)
          
          // Process ALL lines (not just the last one) to build complete baseline
          for (const line of lines) {
            let parsed: any
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            
            // Process assistant records for text, thinking, and tool_use
            if (parsed?.type === 'assistant' && parsed?.isMeta !== true) {
              const msgId = typeof parsed?.uuid === 'string'
                ? parsed.uuid
                : (typeof parsed?.message?.id === 'string' ? parsed.message.id : '')
              if (!msgId) continue
              
              const content = parsed?.message?.content
              
              // Track text baseline
              const text = extractText(content)
              if (text) {
                lastTextByMessageId.set(msgId, text)
              }
              
              // Track thinking baseline
              const thinking = extractThinking(content)
              if (thinking) {
                lastThinkingByMessageId.set(msgId, thinking)
              }
              
              // Track emitted tool calls baseline
              const toolUseBlocks = extractToolUseBlocks(content)
              for (const tool of toolUseBlocks) {
                if (tool.id) {
                  emittedToolCalls.add(`${msgId}:${tool.id}`)
                }
              }
            }
          }
          
          if (DEBUG_RTS) {
            console.log(`[RTS] CC Bootstrap: Built baseline for session ${sessionId}: ` +
              `${lastTextByMessageId.size} texts, ${lastThinkingByMessageId.size} thinking, ${emittedToolCalls.size} tool calls`)
          }
        } finally {
          await fh.close().catch(() => {})
        }
      } catch {
        // ignore
      }
    }

    const extractUsage = (parsed: any): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } => {
      const usage = parsed?.message?.usage
      if (!usage || typeof usage !== 'object') return {}
      const inputTokens = Number((usage as any).input_tokens ?? NaN)
      const outputTokens = Number((usage as any).output_tokens ?? NaN)
      const cacheReadTokens = Number((usage as any).cache_read_input_tokens ?? NaN)
      return {
        ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
        ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
        ...(Number.isFinite(cacheReadTokens) ? { cacheReadTokens } : {}),
      }
    }

    const isCompletedAssistantRecord = (parsed: any): boolean => {
      if (parsed?.type !== 'assistant') return false
      const msg = parsed?.message
      if (!msg || typeof msg !== 'object') return false
      // Claude Code persists final assistant blocks with usage/stop_reason filled.
      if (msg.usage && typeof msg.usage === 'object') return true
      if (msg.stop_reason != null) return true
      return false
    }

    const applyAssistantTextUpdate = (msgId: string, text: string, parsed?: any) => {
      if (!msgId) return
      const prev = lastTextByMessageId.get(msgId) ?? ''
      
      // Always update baseline state, even before initialSyncDone
      if (text && text !== prev) {
        lastTextByMessageId.set(msgId, text)
      }
      
      // Only emit events AFTER initial sync is done
      if (!initialSyncDone) return
      
      if (!text || text === prev) {
        // Still send completion if we learned this record is complete (e.g., usage filled later).
        if (parsed && isCompletedAssistantRecord(parsed)) {
          emitCcStream(sessionId, { type: 'token-usage', usage: extractUsage(parsed), messageId: msgId })
        }
        return
      }

      if (prev && text.startsWith(prev)) {
        const delta = text.slice(prev.length)
        if (delta) {
          emitCcStream(sessionId, { type: 'assistant-message-delta', content: delta, messageId: msgId })
        }
      } else {
        // Non-append update (file rewrites or truncated context): replace with full text.
        emitCcStream(sessionId, { type: 'assistant-message', content: text, messageId: msgId })
      }

      if (parsed && isCompletedAssistantRecord(parsed)) {
        emitCcStream(sessionId, { type: 'token-usage', usage: extractUsage(parsed), messageId: msgId })
      }
    }
    
    const applyThinkingUpdate = (msgId: string, thinking: string) => {
      if (!msgId || !thinking) return
      const prev = lastThinkingByMessageId.get(msgId) ?? ''
      
      // Always update baseline state, even before initialSyncDone
      if (thinking !== prev) {
        lastThinkingByMessageId.set(msgId, thinking)
      }
      
      // Only emit events AFTER initial sync is done
      if (!initialSyncDone) return
      if (thinking === prev) return
      
      if (prev && thinking.startsWith(prev)) {
        const delta = thinking.slice(prev.length)
        if (delta) {
          emitCcStream(sessionId, { type: 'thinking-delta', content: delta, messageId: msgId })
        }
      } else {
        // Full thinking content (for initial or non-delta cases)
        emitCcStream(sessionId, { type: 'thinking-delta', content: thinking, messageId: msgId })
      }
    }
    
    const processToolUseBlocks = (msgId: string, toolUseBlocks: ToolUseBlock[]) => {
      for (const tool of toolUseBlocks) {
        if (!tool.id) continue
        // Avoid duplicate emissions
        const key = `${msgId}:${tool.id}`
        if (emittedToolCalls.has(key)) continue
        emittedToolCalls.add(key)
        
        // Only emit events AFTER initial sync is done
        if (!initialSyncDone) continue
        
        emitCcStream(sessionId, {
          type: 'tool-call',
          tool: tool.name,
          input: tool.input,
          toolUseId: tool.id,
          status: 'running',
          messageId: msgId,
        })
        
        if (DEBUG_RTS) {
          console.log(`[RTS] CC External: Emitted tool-call ${tool.name} (${tool.id}) for session ${sessionId}`)
        }
      }
    }
    
    const processToolResults = (toolResults: ToolResultBlock[]) => {
      // Only emit events AFTER initial sync is done
      if (!initialSyncDone) return
      
      for (const result of toolResults) {
        if (!result.toolUseId) continue
        
        emitCcStream(sessionId, {
          type: 'tool-result',
          toolUseId: result.toolUseId,
          result: result.content,
          toolUseResult: result.isError ? { error: result.content } : { output: result.content },
        })
        
        if (DEBUG_RTS) {
          console.log(`[RTS] CC External: Emitted tool-result for ${result.toolUseId} for session ${sessionId}`)
        }
      }
    }

    const readLatestAssistantFromTail = async (path: string): Promise<{ msgId: string; text: string; parsed: any } | null> => {
      try {
        const st = await stat(path)
        const end = Number(st.size ?? 0)
        if (!Number.isFinite(end) || end <= 0) return null
        const maxBytes = 400_000
        const start = Math.max(0, end - maxBytes)
        const fh = await open(path, 'r')
        try {
          const len = end - start
          const buf = Buffer.alloc(len)
          const res = await fh.read(buf, 0, len, start)
          const txt = buf.subarray(0, res.bytesRead).toString('utf-8')
          const lines = txt.split('\n').filter(Boolean)
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim()
            if (!line) continue
            let parsed: any
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            if (parsed?.type !== 'assistant' || parsed?.isMeta === true) continue
            const msgId = typeof parsed?.uuid === 'string'
              ? parsed.uuid
              : (typeof parsed?.message?.id === 'string' ? parsed.message.id : '')
            if (!msgId) continue
            const text = extractText(parsed?.message?.content)
            return { msgId, text, parsed }
          }
        } finally {
          await fh.close().catch(() => {})
        }
      } catch {
        // ignore
      }
      return null
    }

    const ensureFile = async () => {
      if (filePath) return true
      const resolved = await claudeCode.resolveSessionFilePath(sessionId)
      if (!resolved) {
        if (DEBUG_RTS) {
          console.log(`[RTS] CC External: Could not resolve file for session ${sessionId}`)
        }
        return false
      }
      if (DEBUG_RTS) {
        console.log(`[RTS] CC External: Resolved file for session ${sessionId}: ${resolved}`)
      }
      filePath = resolved
      try {
        const st = await stat(filePath)
        offset = Number(st.size ?? 0)
        lastMtimeMs = st.mtime.getTime()
      } catch {
        offset = 0
      }
      await bootstrapBaseline(filePath)
      return true
    }

    const closeHandle = async () => {
      if (!fileHandle) return
      try {
        await fileHandle.close()
      } catch {
        // ignore
      }
      fileHandle = null
    }

    const pump = async () => {
      if (stopped || pumping) return
      pumping = true
      try {
        const ok = await ensureFile()
        if (!ok || !filePath) return

        const st = await stat(filePath).catch(() => null)
        if (!st) {
          // File doesn't exist - reset
          if (offset > 0) {
            offset = 0
            buffer = ''
            lastTextByMessageId.clear()
            lastThinkingByMessageId.clear()
            emittedToolCalls.clear()
          }
          return
        }
        
        const size = Number(st.size ?? 0)
        const mtimeMs = st.mtime?.getTime?.() ?? 0
        const ino = Number(st.ino ?? 0)
        
        if (!Number.isFinite(size)) return
        
        // Check for file rotation (inode changed)
        if (lastIno !== 0 && ino !== lastIno) {
          if (DEBUG_RTS) {
            console.log(`[RTS] CC External: File rotated for session ${sessionId}`)
          }
          await closeHandle()
          offset = 0
          buffer = ''
          lastTextByMessageId.clear()
          lastThinkingByMessageId.clear()
          emittedToolCalls.clear()
        }
        lastIno = ino
        
        // Check for truncation
        if (size < offset) {
          if (DEBUG_RTS) {
            console.log(`[RTS] CC External: File truncated for session ${sessionId}`)
          }
          offset = 0
          buffer = ''
          lastTextByMessageId.clear()
          lastThinkingByMessageId.clear()
          emittedToolCalls.clear()
        }
        
        if (size === offset) {
          // Some Claude Code versions update transcripts in-place without appending bytes.
          // If mtime changed, re-read tail and diff the latest assistant message.
          if (mtimeMs > lastMtimeMs && filePath) {
            const latest = await readLatestAssistantFromTail(filePath)
            if (latest) {
              applyAssistantTextUpdate(latest.msgId, latest.text, latest.parsed)
            }
          }
          lastMtimeMs = Math.max(lastMtimeMs, mtimeMs)
          return
        }
        lastMtimeMs = Math.max(lastMtimeMs, mtimeMs)

        if (!fileHandle) {
          fileHandle = await open(filePath, 'r')
        }

        const toRead = size - offset
        const buf = Buffer.alloc(toRead)
        const res = await fileHandle.read(buf, 0, toRead, offset)
        offset += res.bytesRead

        const chunk = buf.subarray(0, res.bytesRead).toString('utf-8')
        if (!chunk) return
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let parsed: any
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }

          const recordType = parsed?.type
          
          // Process assistant messages (text, thinking, tool_use)
          if (recordType === 'assistant' && parsed?.isMeta !== true) {
            const msgId = typeof parsed?.uuid === 'string'
              ? parsed.uuid
              : (typeof parsed?.message?.id === 'string' ? parsed.message.id : '')
            if (!msgId) continue
            
            const content = parsed?.message?.content
            
            // Extract and emit text
            const text = extractText(content)
            applyAssistantTextUpdate(msgId, text, parsed)
            
            // Extract and emit thinking
            const thinking = extractThinking(content)
            if (thinking) {
              applyThinkingUpdate(msgId, thinking)
            }
            
            // Extract and emit tool_use blocks
            const toolUseBlocks = extractToolUseBlocks(content)
            if (toolUseBlocks.length > 0) {
              processToolUseBlocks(msgId, toolUseBlocks)
            }
          }
          
          // Process user messages (for tool_result AND user text)
          if (recordType === 'user') {
            const content = parsed?.message?.content
            
            // Only emit user messages AFTER initial sync is done
            if (initialSyncDone) {
              // Extract and emit user text (the actual user message)
              const userText = extractText(content)
              if (userText) {
                const userMsgId = typeof parsed?.uuid === 'string'
                  ? parsed.uuid
                  : `user-${Date.now()}`
                emitCcStream(sessionId, { 
                  type: 'user-message', 
                  content: userText, 
                  messageId: userMsgId 
                })
                if (DEBUG_RTS) {
                  console.log(`[RTS] CC External: Emitted user-message for session ${sessionId}`)
                }
              }
            }
            
            // Extract and emit tool results (processToolResults already has initialSyncDone check)
            const toolResults = extractToolResults(content)
            if (toolResults.length > 0) {
              processToolResults(toolResults)
            }
          }
        }
        
        // Mark initial sync as done after first successful pump
        // This ensures we only emit NEW events from this point on
        if (!initialSyncDone) {
          initialSyncDone = true
          if (DEBUG_RTS) {
            console.log(`[RTS] CC External: Initial sync done for session ${sessionId}, will now emit events`)
          }
        }
      } catch (err) {
        // If the file was rotated/deleted, reset and retry.
        if (DEBUG_RTS) {
          console.log(`[RTS] CC External: Error in pump for session ${sessionId}:`, err)
        }
        await closeHandle()
        filePath = null
      } finally {
        pumping = false
      }
    }

    const start = () => {
      // Poll at 100ms for real-time sync (5x faster than previous 500ms)
      pollTimer = setInterval(() => {
        void pump()
      }, 100)

      void ensureFile().then((ok) => {
        if (!ok || !filePath || stopped) return
        
        // Watch the file itself
        try {
          watcher = fsWatch(filePath, { persistent: false }, () => {
            void pump()
          })
          watcher.on('error', () => {
            if (watcher) {
              try { watcher.close() } catch {}
              watcher = null
            }
          })
        } catch {
          // ignore (polling will handle)
        }
        
        // Also watch parent directory for more reliable notifications
        try {
          const parentDir = dirname(filePath)
          dirWatcher = fsWatch(parentDir, { persistent: false }, (_, filename) => {
            if (filename && filePath?.endsWith(filename)) {
              void pump()
            }
          })
          dirWatcher.on('error', () => {
            if (dirWatcher) {
              try { dirWatcher.close() } catch {}
              dirWatcher = null
            }
          })
        } catch {
          // ignore (polling will handle)
        }
      })
      
      if (DEBUG_RTS) {
        console.log(`[RTS] CC External: Started tailing session ${sessionId}`)
      }
    }

    start()

    return {
      stop: () => {
        stopped = true
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        if (watcher) {
          try {
            watcher.close()
          } catch {}
          watcher = null
        }
        if (dirWatcher) {
          try {
            dirWatcher.close()
          } catch {}
          dirWatcher = null
        }
        void closeHandle()
        
        if (DEBUG_RTS) {
          console.log(`[RTS] CC External: Stopped tailing session ${sessionId}`)
        }
      },
    }
  }

  const resolveCodexExternalSessionFile = async (threadId: string): Promise<string | null> => {
    const baseDir = resolve(homedir(), '.codex', 'sessions')
    const id = threadId.trim()
    if (!id) return null

    // Fast path: exact stem match
    const direct = resolve(baseDir, `${id}.jsonl`)
    try {
      const st = await stat(direct)
      if (st.isFile()) return direct
    } catch {
      // ignore
    }

    // Common case: filenames include the thread/session id as a suffix.
    const pattern = `**/*${id}*.jsonl`
    let best: { path: string; mtimeMs: number } | null = null
    try {
      const glob = new Bun.Glob(pattern)
      for await (const rel of glob.scan({ cwd: baseDir, onlyFiles: true })) {
        const abs = resolve(baseDir, rel)
        const st = await stat(abs).catch(() => null)
        if (!st?.isFile()) continue
        const mtimeMs = st.mtime.getTime()
        if (!best || mtimeMs > best.mtimeMs) best = { path: abs, mtimeMs }
      }
    } catch {
      // ignore
    }

    return best?.path ?? null
  }

  const startCodexExternalTail = (threadId: string): { stop: () => void } => {
    let stopped = false
    let filePath: string | null = null
    let fileHandle: any | null = null
    let offset = 0
    let buffer = ''
    let watcher: FSWatcher | null = null
    let dirWatcher: FSWatcher | null = null
    let pollTimer: Timer | null = null
    let pumping = false
    let turnInProgress = false
    let lastIno = 0
    let initialSyncDone = false // Skip emitting events until first pump completes (builds baseline)
    const emittedItems = new Set<string>() // Track emitted items to avoid duplicates

    const closeHandle = async () => {
      if (!fileHandle) return
      try {
        await fileHandle.close()
      } catch {
        // ignore
      }
      fileHandle = null
    }

    const ensureFile = async () => {
      if (filePath) return true
      const resolved = await resolveCodexExternalSessionFile(threadId)
      if (!resolved) {
        if (DEBUG_RTS) {
          console.log(`[RTS] CX External: Could not resolve file for thread ${threadId}`)
        }
        return false
      }
      if (DEBUG_RTS) {
        console.log(`[RTS] CX External: Resolved file for thread ${threadId}: ${resolved}`)
      }
      filePath = resolved
      try {
        const st = await stat(filePath)
        offset = Number(st.size ?? 0)
        lastIno = Number(st.ino ?? 0)
      } catch {
        offset = 0
        lastIno = 0
      }
      // Bootstrap baseline from existing records
      await bootstrapBaseline(resolved)
      return true
    }

    const bootstrapBaseline = async (path: string) => {
      // Reads ALL existing records to build baseline state (emittedItems)
      // This prevents re-emitting historical events when the external tail starts.
      try {
        const st = await stat(path)
        const end = Number(st.size ?? 0)
        if (!Number.isFinite(end) || end <= 0) return
        const maxBytes = 400_000
        const start = Math.max(0, end - maxBytes)
        const fh = await open(path, 'r')
        try {
          const len = end - start
          const buf = Buffer.alloc(len)
          const res = await fh.read(buf, 0, len, start)
          const txt = buf.subarray(0, res.bytesRead).toString('utf-8')
          const lines = txt.split('\n').filter(Boolean)
          
          // Process ALL lines to build baseline (track emitted items)
          for (const line of lines) {
            let parsed: any
            try {
              parsed = JSON.parse(line)
            } catch {
              continue
            }
            
            const outerType = parsed?.type as string | undefined
            const payload = parsed?.payload ?? null
            
            // Track response_item records for baseline
            if (outerType === 'response_item') {
              const item = payload?.item ?? payload
              const itemId = safeString(item?.id) || ''
              if (itemId) {
                emittedItems.add(itemId)
              }
            }
          }
          
          if (DEBUG_RTS) {
            console.log(`[RTS] CX Bootstrap: Built baseline for thread ${threadId}: ${emittedItems.size} items tracked`)
          }
        } finally {
          await fh.close().catch(() => {})
        }
      } catch {
        // ignore
      }
    }

    const emit = (method: string, params: Record<string, unknown>) => {
      // Only emit events AFTER initial sync is done
      if (!initialSyncDone) return
      emitCxStream(threadId, { type: 'notification', method, params: { threadId, ...params } })
    }

    const pump = async () => {
      if (stopped || pumping) return
      pumping = true
      try {
        const ok = await ensureFile()
        if (!ok || !filePath) return

        const st = await stat(filePath).catch(() => null)
        if (!st) {
          // File doesn't exist - reset
          if (offset > 0) {
            offset = 0
            buffer = ''
            turnInProgress = false
            emittedItems.clear()
          }
          return
        }
        
        const size = Number(st.size ?? 0)
        const ino = Number(st.ino ?? 0)
        
        if (!Number.isFinite(size)) return
        
        // Check for file rotation (inode changed)
        if (lastIno !== 0 && ino !== lastIno) {
          if (DEBUG_RTS) {
            console.log(`[RTS] CX External: File rotated for thread ${threadId}`)
          }
          await closeHandle()
          offset = 0
          buffer = ''
          turnInProgress = false
          emittedItems.clear()
        }
        lastIno = ino
        
        // Check for truncation
        if (size < offset) {
          if (DEBUG_RTS) {
            console.log(`[RTS] CX External: File truncated for thread ${threadId}`)
          }
          offset = 0
          buffer = ''
          turnInProgress = false
          emittedItems.clear()
        }
        
        if (size === offset) return

        if (!fileHandle) {
          fileHandle = await open(filePath, 'r')
        }

        const toRead = size - offset
        const buf = Buffer.alloc(toRead)
        const res = await fileHandle.read(buf, 0, toRead, offset)
        offset += res.bytesRead

        const chunk = buf.subarray(0, res.bytesRead).toString('utf-8')
        if (!chunk) return
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let parsed: any
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }

          const outerType = parsed?.type as string | undefined
          const payload = parsed?.payload ?? null

          // Handle event_msg records
          if (outerType === 'event_msg') {
            const payloadType = payload?.type
            
            if (payloadType === 'user_message') {
              if (!turnInProgress) {
                turnInProgress = true
                emit('turn/started', {})
                if (DEBUG_RTS) {
                  console.log(`[RTS] CX External: turn/started for thread ${threadId}`)
                }
              }
              continue
            }

            if (payloadType === 'agent_reasoning' && typeof payload?.text === 'string') {
              const delta = payload.text
              if (delta) {
                emit('item/reasoning/textDelta', {
                  itemId: `cx-ext-thinking-${threadId}`,
                  delta,
                })
              }
              continue
            }

            if (payloadType === 'agent_message') {
              const text = typeof payload?.message === 'string'
                ? payload.message
                : (typeof payload?.text === 'string' ? payload.text : '')
              if (text) {
                const ts = typeof parsed?.timestamp === 'string' ? parsed.timestamp : `${Date.now()}`
                const itemId = `cx-ext-msg-${ts.replaceAll(/[^a-zA-Z0-9]/g, '_')}`
                emit('item/agentMessage/delta', { itemId, delta: text })
                if (turnInProgress) {
                  turnInProgress = false
                  emit('turn/completed', {})
                  if (DEBUG_RTS) {
                    console.log(`[RTS] CX External: turn/completed for thread ${threadId}`)
                  }
                }
              }
              continue
            }
            
            // Handle turn_completed event
            if (payloadType === 'turn_completed') {
              if (turnInProgress) {
                turnInProgress = false
                emit('turn/completed', { usage: payload?.usage })
                if (DEBUG_RTS) {
                  console.log(`[RTS] CX External: turn/completed (explicit) for thread ${threadId}`)
                }
              }
              continue
            }
          }
          
          // Handle response_item records (tool calls)
          if (outerType === 'response_item') {
            const item = payload?.item ?? payload
            const itemType = safeString(item?.type)
            const itemId = safeString(item?.id) || `cx-ext-item-${Date.now()}`
            
            // Avoid duplicate emissions
            if (emittedItems.has(itemId)) continue
            
            if (itemType === 'function_call') {
              emittedItems.add(itemId)
              const name = safeString(item?.name)
              let args: any = {}
              try {
                args = typeof item?.arguments === 'string' ? JSON.parse(item.arguments) : (item?.arguments ?? {})
              } catch {}
              
              emit('item/started', {
                item: {
                  id: itemId,
                  type: 'commandExecution',
                  command: args?.command || name,
                  status: 'running',
                },
              })
              
              if (DEBUG_RTS) {
                console.log(`[RTS] CX External: item/started (function_call) ${name} for thread ${threadId}`)
              }
              continue
            }
            
            if (itemType === 'function_call_output') {
              const callId = safeString(item?.call_id)
              const output = safeString(item?.output)
              
              emit('item/completed', {
                item: {
                  id: callId || itemId,
                  type: 'commandExecution',
                  status: 'completed',
                  output,
                },
              })
              
              if (DEBUG_RTS) {
                console.log(`[RTS] CX External: item/completed (function_call_output) for thread ${threadId}`)
              }
              continue
            }
            
            // Handle file change items
            if (itemType === 'file_change' || itemType === 'fileChange') {
              emittedItems.add(itemId)
              const changes = Array.isArray(item?.changes) ? item.changes : []
              
              emit('item/started', {
                item: {
                  id: itemId,
                  type: 'fileChange',
                  changes,
                  status: 'running',
                },
              })
              
              if (DEBUG_RTS) {
                console.log(`[RTS] CX External: item/started (fileChange) for thread ${threadId}`)
              }
              continue
            }
          }
        }
        
        // Mark initial sync as done after first successful pump
        // This ensures we only emit NEW events from this point on
        if (!initialSyncDone) {
          initialSyncDone = true
          if (DEBUG_RTS) {
            console.log(`[RTS] CX External: Initial sync done for thread ${threadId}, will now emit events`)
          }
        }
      } catch (err) {
        if (DEBUG_RTS) {
          console.log(`[RTS] CX External: Error in pump for thread ${threadId}:`, err)
        }
        await closeHandle()
        filePath = null
      } finally {
        pumping = false
      }
    }

    // Poll at 100ms for real-time sync (5x faster than previous 500ms)
    pollTimer = setInterval(() => {
      void pump()
    }, 100)

    void ensureFile().then((ok) => {
      if (!ok || !filePath || stopped) return
      
      // Watch the file itself
      try {
        watcher = fsWatch(filePath, { persistent: false }, () => {
          void pump()
        })
        watcher.on('error', () => {
          if (watcher) {
            try { watcher.close() } catch {}
            watcher = null
          }
        })
      } catch {
        // ignore (polling will handle)
      }
      
      // Also watch parent directory for more reliable notifications
      try {
        const parentDir = dirname(filePath)
        dirWatcher = fsWatch(parentDir, { persistent: false }, (_, filename) => {
          if (filename && filePath?.endsWith(filename)) {
            void pump()
          }
        })
        dirWatcher.on('error', () => {
          if (dirWatcher) {
            try { dirWatcher.close() } catch {}
            dirWatcher = null
          }
        })
      } catch {
        // ignore (polling will handle)
      }
    })
    
    if (DEBUG_RTS) {
      console.log(`[RTS] CX External: Started tailing thread ${threadId}`)
    }

    return {
      stop: () => {
        stopped = true
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        if (watcher) {
          try {
            watcher.close()
          } catch {}
          watcher = null
        }
        if (dirWatcher) {
          try {
            dirWatcher.close()
          } catch {}
          dirWatcher = null
        }
        void closeHandle()
        
        if (DEBUG_RTS) {
          console.log(`[RTS] CX External: Stopped tailing thread ${threadId}`)
        }
      },
    }
  }

  const syncExternalTailForKey = (key: string | null) => {
    if (!key) return
    const parsed = parseSessionKey(key)
    if (!parsed) return
    const { agent, id } = parsed
    const watchers = sessionWatchers.get(key)
    const watcherCount = watchers?.size ?? 0

    if (agent === 'claude-code') {
      const owner = ccSessionOwners.get(id) ?? null
      const shouldRun = watcherCount > 0 && !owner
      if (DEBUG_RTS) {
        console.log(`[RTS] syncExternalTail(CC): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${ccExternalTails.has(id)}`)
      }
      if (shouldRun) {
        if (!ccExternalTails.has(id)) {
          if (DEBUG_RTS) {
            console.log(`[RTS] Starting Claude Code external tail for session ${id}`)
          }
          ccExternalTails.set(id, startClaudeCodeExternalTail(id))
        }
      } else {
        stopCcExternalTail(id)
      }
      return
    }

    if (agent === 'codex') {
      const owner = cxThreadOwners.get(id) ?? null
      const shouldRun = watcherCount > 0 && !owner
      if (DEBUG_RTS) {
        console.log(`[RTS] syncExternalTail(CX): id=${id}, watchers=${watcherCount}, owner=${!!owner}, shouldRun=${shouldRun}, alreadyRunning=${cxExternalTails.has(id)}`)
      }
      if (shouldRun) {
        if (!cxExternalTails.has(id)) {
          if (DEBUG_RTS) {
            console.log(`[RTS] Starting Codex external tail for thread ${id}`)
          }
          cxExternalTails.set(id, startCodexExternalTail(id))
        }
      } else {
        stopCxExternalTail(id)
      }
      return
    }

    if (agent === 'opencode') {
      // OpenCode external tail: poll session messages API when TUI is running externally
      // The TUI runs in a Bun Worker and events don't reach global.event() stream
      const projectPath = ocSessionProjectPaths.get(id)
      const shouldRun = watcherCount > 0 && projectPath
      if (shouldRun) {
        if (!ocExternalTails.has(id)) {
          ocExternalTails.set(id, startOpenCodeExternalTail(id, projectPath))
          if (DEBUG_RTS) {
            console.log(`[RTS] Starting OpenCode external tail for session ${id}`)
          }
        }
      } else {
        stopOcExternalTail(id)
      }
    }
  }

  const updateSessionWatchers = (
    ws: ServerWebSocket<unknown>,
    prevKey: string | null,
    nextKey: string | null,
  ) => {
    if (prevKey) {
      const prevSet = sessionWatchers.get(prevKey)
      if (prevSet) {
        prevSet.delete(ws)
        if (prevSet.size === 0) sessionWatchers.delete(prevKey)
      }
      syncExternalTailForKey(prevKey)
    }
    if (nextKey) {
      let nextSet = sessionWatchers.get(nextKey)
      if (!nextSet) {
        nextSet = new Set()
        sessionWatchers.set(nextKey, nextSet)
      }
      nextSet.add(ws)
      syncExternalTailForKey(nextKey)
    }
  }

  const broadcastToSessionWatchers = (
    agent: AgentType,
    sessionId: string,
    message: ServerMessage,
    owner?: ServerWebSocket<unknown> | null,
  ) => {
    const key = makeSessionKey(agent, sessionId)
    if (!key) return
    const watchers = sessionWatchers.get(key)
    if (!watchers) return
    for (const ws of watchers) {
      if (owner && ws === owner) continue
      send(ws, message)
    }
  }

  const emitCcStream = (
    sessionId: string,
    streamMsg: unknown,
    owner?: ServerWebSocket<unknown> | null,
  ) => {
    const payload: ServerMessage = { type: 'cc_stream', data: streamMsg, sessionId }
    const resolvedOwner = owner ?? ccSessionOwners.get(sessionId) ?? null
    const key = makeSessionKey('claude-code', sessionId)
    const watchers = key ? sessionWatchers.get(key) : null
    
    if (DEBUG_RTS) {
      const msgType = (streamMsg as any)?.type ?? 'unknown'
      console.log(`[RTS] emitCcStream: session=${sessionId}, msgType=${msgType}, owner=${!!resolvedOwner}, watchers=${watchers?.size ?? 0}`)
    }
    
    if (resolvedOwner) {
      send(resolvedOwner, payload)
    }
    broadcastToSessionWatchers('claude-code', sessionId, payload, resolvedOwner)
  }

  const emitCxStream = (
    threadId: string,
    streamMsg: CodexStreamMessage,
    owner?: ServerWebSocket<unknown> | null,
  ) => {
    const payload: ServerMessage = { type: 'cx_stream', data: streamMsg, threadId }
    const key = makeSessionKey('codex', threadId)
    const watchers = key ? sessionWatchers.get(key) : null
    
    if (DEBUG_RTS) {
      const msgType = (streamMsg as any)?.type ?? (streamMsg as any)?.method ?? 'unknown'
      console.log(`[RTS] emitCxStream: thread=${threadId}, msgType=${msgType}, owner=${!!owner}, watchers=${watchers?.size ?? 0}`)
    }
    
    if (owner) {
      send(owner, payload)
    }
    broadcastToSessionWatchers('codex', threadId, payload, owner)
  }

  let eventCount = 0
  let eventCountResetTimer: Timer | null = null

  const extractSessionId = (event: any): string | null => {
    const payload = event?.payload ?? null
    const properties = payload?.properties ?? null
    const info = properties?.info ?? null
    const part = properties?.part ?? null
    
    // Try all possible sessionId field locations and formats
    const sessionId =
      // Standard SDK locations
      (typeof info?.sessionID === 'string' && info.sessionID) ||
      (typeof info?.sessionId === 'string' && info.sessionId) ||
      (typeof properties?.sessionID === 'string' && properties.sessionID) ||
      (typeof properties?.sessionId === 'string' && properties.sessionId) ||
      (typeof part?.sessionID === 'string' && part.sessionID) ||
      (typeof part?.sessionId === 'string' && part.sessionId) ||
      // Root level (some events have sessionId at root)
      (typeof event?.sessionID === 'string' && event.sessionID) ||
      (typeof event?.sessionId === 'string' && event.sessionId) ||
      // Payload level (some events have sessionId directly in payload)
      (typeof payload?.sessionID === 'string' && payload.sessionID) ||
      (typeof payload?.sessionId === 'string' && payload.sessionId)
    
    return sessionId ? String(sessionId) : null
  }

  const getEventType = (event: any): string => {
    const payload = event?.payload ?? null
    return typeof payload?.type === 'string' ? payload.type : ''
  }

  const getEventPriority = (event: unknown): 'immediate' | 'high' | 'normal' | 'low' => {
    const eventType = getEventType(event)
    return MESSAGE_PRIORITIES[eventType] ?? 'normal'
  }

  const getBatchInterval = (ctx: ConnectionContext): number => {
    const rtt = ctx.lastRttMs

    let thresholds = BATCH_THRESHOLDS.local
    if (rtt > 100) {
      thresholds = BATCH_THRESHOLDS.highLatency
    } else if (rtt > 30 || ctx.connectionType === 'tailscale') {
      thresholds = BATCH_THRESHOLDS.tailscale
    }

    if (eventCount > 50) return thresholds.burst
    if (eventCount > 20) return thresholds.high
    return thresholds.low
  }

  const filterEventForSocket = (ws: ServerWebSocket<unknown>, event: unknown): boolean => {
    const ctx = contexts.get(ws)
    if (!ctx || (!ctx.projectPath && !ctx.sessionId)) {
      if (DEBUG_RTS) {
        console.log('[RTS] filterEventForSocket: No context, passing through')
      }
      return true
    }

    const e = event as any
    const safeDecode = (s: string) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    }

    const normalizeDirectory = (dir: string) => safeDecode(dir).replace(/\/+$/, '')
    const directoryRaw = (typeof e?.directory === 'string' ? e.directory : null) ?? 'global'
    const directory = directoryRaw === 'global' ? 'global' : normalizeDirectory(directoryRaw)
    const projectPath = ctx.projectPath && ctx.projectPath !== 'global'
      ? normalizeDirectory(ctx.projectPath)
      : ctx.projectPath

    if (ctx.projectPath === 'global') {
      // Global view = receive ALL events (enables multi-device real-time sync)
      if (DEBUG_RTS) {
        console.log('[RTS] filterEventForSocket: Global view, passing all events')
      }
      return true
    }

    if (ctx.sessionId) {
      const sid = extractSessionId(event)
      // If the event is scoped to a session, prioritize session routing over directory routing.
      // This keeps cross-device streaming working even if directory strings differ (e.g. symlinks).
      if (sid) {
        const match = sid === ctx.sessionId
        if (DEBUG_RTS) {
          const eventType = getEventType(event)
          console.log(`[RTS] filterEventForSocket: Session match check - eventSessionId=${sid}, ctxSessionId=${ctx.sessionId}, match=${match}, eventType=${eventType}`)
        }
        return match
      }
    }

    if (projectPath && directory !== 'global' && directory !== projectPath) {
      if (DEBUG_RTS) {
        console.log(`[RTS] filterEventForSocket: Directory mismatch - eventDir=${directory}, ctxDir=${projectPath}`)
      }
      return false
    }

    if (DEBUG_RTS) {
      console.log('[RTS] filterEventForSocket: Passing through (default)')
    }
    return true
  }

  const flushClientQueue = (ws: ServerWebSocket<unknown>) => {
    const clientQ = clientQueues.get(ws)
    if (!clientQ || clientQ.queue.length === 0) return

    clientQ.timer = null
    const events = clientQ.queue.splice(0, clientQ.queue.length)

    const filtered = events.filter((event) => filterEventForSocket(ws, event))
    if (filtered.length > 0) {
      send(ws, { type: 'sdk_event_batch', data: filtered })
    }
  }

  const enqueueForClient = (ws: ServerWebSocket<unknown>, event: unknown) => {
    let clientQ = clientQueues.get(ws)
    if (!clientQ) {
      clientQ = { queue: [], timer: null }
      clientQueues.set(ws, clientQ)
    }

    clientQ.queue.push(event)

    if (clientQ.timer) return

    const ctx = contexts.get(ws) ?? { lastPongAt: Date.now(), lastRttMs: 0, connectionType: 'unknown' as const }
    const batchMs = getBatchInterval(ctx)

    clientQ.timer = setTimeout(() => flushClientQueue(ws), batchMs)
  }

  const enqueueSdkEvent = (event: unknown) => {
    eventCount++

    if (!eventCountResetTimer) {
      eventCountResetTimer = setTimeout(() => {
        eventCount = 0
        eventCountResetTimer = null
      }, 1000)
    }

    const priority = getEventPriority(event)
    
    if (DEBUG_RTS) {
      const eventType = getEventType(event)
      const sid = extractSessionId(event)
      const e = event as any
      const directory = typeof e?.directory === 'string' ? e.directory : 'global'
      console.log(`[RTS] enqueueSdkEvent: type=${eventType}, sessionId=${sid || 'none'}, dir=${directory}, priority=${priority}, sockets=${sockets.size}`)
    }

    let deliveredCount = 0
    for (const ws of sockets) {
      if (!filterEventForSocket(ws, event)) continue
      deliveredCount++

      if (priority === 'immediate' || priority === 'high') {
        send(ws, { type: 'sdk_event', data: event })
      } else {
        enqueueForClient(ws, event)
      }
    }
    
    if (DEBUG_RTS && deliveredCount === 0 && sockets.size > 0) {
      console.log(`[RTS] enqueueSdkEvent: WARNING - Event not delivered to any socket!`)
    }

    // Keep the hot path lean: forward SDK events first, then do any heavier work.
    queueMicrotask(() => {
      try {
        const e = event as any
        const directory = safeString(e?.directory)
        const payloadType = safeString(e?.payload?.type)

        if (payloadType === 'vcs.branch.updated' && directory) {
          const branch = safeString(e?.payload?.properties?.branch)
          if (branch) lastGitBranchByProject.set(directory, branch)
        }

        // Trigger enrichment on session idle (natural batching).
        // TODO(artifacts): Re-enable when feature is ready
        if (ARTIFACTS_ENABLED && payloadType === 'session.idle') {
          const sid = extractSessionId(event)
          if (sid) artifactsEnrichment?.queueArtifactsEnrichmentForSession(sid)
        }

        // Artifact indexing (OpenCode): capture completed file-write tools.
        // TODO(artifacts): Re-enable when feature is ready
        if (!ARTIFACTS_ENABLED) return
        if (payloadType !== 'message.part.updated') return
        if (!directory || directory === 'global') return

        const part = e?.payload?.properties?.part
        if (part?.type !== 'tool' || typeof part !== 'object') return

        const stateInfo = part?.state ?? {}
        const status = safeString(stateInfo?.status)
        const tool = safeString(part?.tool)

        const isCompleted = status === 'completed' || status === 'success'
        if (!isCompleted) return

        const toolLower = tool.toLowerCase()
        const isFileWriteTool =
          toolLower === 'write' ||
          toolLower === 'edit' ||
          toolLower === 'multiedit' ||
          toolLower === 'patch' ||
          toolLower === 'notebookedit'
        if (!isFileWriteTool) return

        const metadata = (stateInfo?.metadata && typeof stateInfo.metadata === 'object') ? stateInfo.metadata : {}
        const input = (stateInfo?.input && typeof stateInfo.input === 'object') ? stateInfo.input : {}

        const filePath =
          safeString(metadata?.filePath) ||
          safeString(input?.filePath) ||
          safeString(input?.path)
        if (!filePath) return

        const structuredPatch = metadata?.structuredPatch
        const unifiedDiff = safeString(metadata?.diff) || structuredPatchToUnifiedDiff(filePath, structuredPatch)

        const sessionId =
          safeString(part?.sessionID) ||
          safeString(part?.session_id) ||
          safeString(part?.sessionId) ||
          ''
        const toolUseId =
          safeString(part?.callID) ||
          safeString(part?.call_id) ||
          safeString(part?.callId) ||
          safeString(part?.id) ||
          safeString(part?.toolCallId) ||
          ''

        if (DEBUG_ARTIFACTS) {
          console.log('[Artifacts DEBUG] enqueue:', { filePath, tool, directory, sessionId, toolUseId })
        }

        artifactIndex?.enqueue({
          backend: 'opencode',
          sessionId: sessionId || `session_${Date.now()}`,
          messageId: safeString(part?.messageID) || safeString(part?.message_id) || safeString(part?.messageId) || null,
          toolUseId: toolUseId || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          projectPath: directory,
          gitBranch: lastGitBranchByProject.get(directory) ?? null,
          tool,
          toolInput: input,
          toolOutput: typeof stateInfo?.output === 'string' ? stateInfo.output : null,
          filePath,
          contentBefore: safeString(metadata?.oldString) || null,
          contentAfter: safeString(metadata?.newString) || null,
          unifiedDiff: unifiedDiff || null,
          timestamp: typeof stateInfo?.time?.end === 'number' ? stateInfo.time.end : Date.now(),
        })
      } catch (err) {
        console.warn('[Artifacts] Failed to process OpenCode artifact event:', err)
      }
    })
  }

  const HEARTBEAT_INTERVAL_MS = 20000
  const HEARTBEAT_DEAD_AFTER_MS = 90000
  
  // Tick heartbeat: Sent every 30 seconds to all clients.
  // Clients use this to detect stale connections (if no tick in 2x interval = dead).
  // This is separate from ping/pong (which measures RTT).
  const TICK_INTERVAL_MS = 30000

  const heartbeatTimer = setInterval(() => {
    const now = Date.now()
    for (const ws of sockets) {
      const ctx = contexts.get(ws)
      if (!ctx) continue

      if (now - ctx.lastPongAt > HEARTBEAT_DEAD_AFTER_MS) {
        try {
          ws.close(4000, 'Heartbeat timeout')
        } catch {
          // ignore
        }
        continue
      }

      // Only keep one in-flight ping per client to make RTT meaningful.
      if (ctx.pendingPing) continue

      const ping = {
        id: `ping_${now}_${Math.floor(Math.random() * 1_000_000)}`,
        sentAt: now,
      }
      ctx.pendingPing = ping
      send(ws, { type: 'ping', data: ping })
    }
  }, HEARTBEAT_INTERVAL_MS)
  
  // Tick timer: Simple liveness signal to all connected clients.
  // Clients should expect a tick every TICK_INTERVAL_MS. If 2x interval passes
  // without a tick, the client should consider the connection dead and reconnect.
  const tickTimer = setInterval(() => {
    const now = Date.now()
    const tickPayload = { type: 'tick', timestamp: now, interval: TICK_INTERVAL_MS }
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(tickPayload))
      } catch {
        // Client might have disconnected, ignore
      }
    }
  }, TICK_INTERVAL_MS)

  const handleHttp = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return jsonResponse({ status: 'ok', version })
    }

    if (url.pathname === '/projects') {
      try {
        const data = await opencode.listProjects()
        return jsonResponse(data)
      } catch (error) {
        return jsonResponse({ error: toErrorMessage(error) }, 500)
      }
    }

    if (url.pathname === '/browse') {
      const path = url.searchParams.get('path')
      if (!path) {
        return jsonResponse({ error: 'Missing path' }, 400)
      }

      try {
        // Use direct file listing (doesn't require OpenCode SDK)
        const items = await listFilesDirectly(path as string)
        return jsonResponse({ path, items })
      } catch (error) {
        return jsonResponse({ error: toErrorMessage(error) }, 500)
      }
    }

    return new Response('Not found', { status: 404 })
  }

  const server = Bun.serve({
    port: options.port,
    fetch(request, serverInstance) {
      const url = new URL(request.url)
      
      const tokenFromQuery = url.searchParams.get('token')
      const authHeader = request.headers.get('authorization')
      const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
      const providedToken = tokenFromQuery || tokenFromHeader
      
      const isWebSocketUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      const isValidToken = providedToken && validateAuthToken(providedToken, authToken)
      
      if (isWebSocketUpgrade) {
        if (!isValidToken) {
          log('Connection rejected: invalid or missing auth token')
          return new Response('Unauthorized', { status: 401 })
        }
        if (serverInstance.upgrade(request)) return
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      
      if (!isValidToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
      
      return handleHttp(request)
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        contexts.set(ws, { 
          lastPongAt: Date.now(), 
          lastRttMs: 0, 
          connectionType: 'unknown',
          connectedAt: Date.now(),
        })
        log(`Client connected (${sockets.size} total)`)
        void sendStatus(ws)
      },
      close(ws) {
        const ctx = contexts.get(ws)
        const disconnectedDeviceId = ctx?.deviceId
        const disconnectedDeviceName = ctx?.deviceName
        const prevKey = makeSessionKey(ctx?.viewAgent, ctx?.sessionId)
        updateSessionWatchers(ws, prevKey, null)

        // If this socket owned any CC/Codex sessions, release ownership so watchers can fall back
        // to external tailing (or another owner) correctly.
        const releasedKeys: Array<{ agent: AgentType; id: string }> = []
        for (const [sid, owner] of ccSessionOwners.entries()) {
          if (owner === ws) {
            ccSessionOwners.delete(sid)
            releasedKeys.push({ agent: 'claude-code', id: sid })
          }
        }
        for (const [tid, owner] of cxThreadOwners.entries()) {
          if (owner === ws) {
            cxThreadOwners.delete(tid)
            releasedKeys.push({ agent: 'codex', id: tid })
            // Clear approval cache for this thread
            for (const key of cxApprovalCache.keys()) {
              if (key.startsWith(`${tid}:`)) {
                cxApprovalCache.delete(key)
              }
            }
          }
        }
        for (const k of releasedKeys) {
          syncExternalTailForKey(makeSessionKey(k.agent, k.id))
        }
        
        sockets.delete(ws)
        contexts.delete(ws)
        const clientQ = clientQueues.get(ws)
        if (clientQ?.timer) {
          clearTimeout(clientQ.timer)
        }
        clientQueues.delete(ws)

        // Remove from any PTY listener sets; close PTYs that have no listeners.
        for (const [ptyId, listeners] of ptyListeners.entries()) {
          if (!listeners.delete(ws)) continue
          if (listeners.size === 0) {
            closePtyIfNoListeners(ptyId)
          }
        }
        log(`Client disconnected (${sockets.size} total)`)
        
        if (disconnectedDeviceId) {
          broadcast({ 
            type: 'device_disconnected', 
            data: { 
              deviceId: disconnectedDeviceId,
              deviceName: disconnectedDeviceName,
            } 
          })
        }
      },
      message(ws, raw) {
        void handleMessage(ws, raw)
      },
    },
  })
  const actualPort = (server as any).port ?? options.port

  const sendStatus = async (ws: ServerWebSocket<unknown>) => {
    const running = await opencode.isRunning()
    send(ws, { type: 'status', data: { opencodeRunning: running } })
  }

  const processSingleMessage = async (
    ws: ServerWebSocket<unknown>,
    message: ClientMessage & { requestId?: string },
    reply: (response: ServerMessage) => void,
  ) => {
    switch (message.type) {
      case 'register_device': {
        const existing = contexts.get(ws) ?? { 
          lastPongAt: Date.now(), 
          lastRttMs: 0, 
          connectionType: 'unknown' as const,
          connectedAt: Date.now(),
        }
        contexts.set(ws, {
          ...existing,
          deviceId: message.deviceId,
          deviceName: message.deviceName,
          platform: message.platform,
        })
        const deviceInfo = getDeviceInfo(ws)
        if (deviceInfo) {
          reply({ type: 'device_registered', data: deviceInfo })
          broadcast({ type: 'device_connected', data: deviceInfo })
        }
        log(`Device registered: ${message.deviceName} (${message.platform})`)
        break
      }
      case 'list_devices': {
        const devices = getAllDevices()
        reply({ type: 'devices', data: devices })
        break
      }
      case 'disconnect_device': {
        const targetWs = findSocketByDeviceId(message.deviceId)
        if (targetWs && targetWs !== ws) {
          const targetCtx = contexts.get(targetWs)
          try {
            targetWs.close(4001, 'Disconnected by another device')
          } catch {
            // ignore
          }
          broadcast({ 
            type: 'device_disconnected', 
            data: { 
              deviceId: message.deviceId,
              deviceName: targetCtx?.deviceName,
            } 
          })
        }
        break
      }
      case 'set_view': {
          const existing = contexts.get(ws) ?? { lastPongAt: Date.now(), lastRttMs: 0 }
          const prevKey = makeSessionKey(existing.viewAgent, existing.sessionId)
          const nextAgent =
            message.agent ??
            existing.viewAgent ??
            (message.projectPath || message.sessionId ? 'opencode' : undefined)
          const nextSessionId = message.sessionId || undefined

          if (DEBUG_RTS) {
            console.log(`[RTS] set_view: agent=${nextAgent}, sessionId=${nextSessionId}, projectPath=${message.projectPath}, prevKey=${prevKey}`)
          }

          if (nextAgent === 'claude-code') {
            const cwd = message.projectPath && message.projectPath !== 'global'
              ? message.projectPath
              : undefined
            if (cwd) {
              ensureClaudeWatchDir(join(cwd, '.claude', 'skills'), 'skills', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'plugins'), 'plugins', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'commands'), 'commands', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'hooks'), 'hooks', cwd)
              ensureClaudeWatchDir(join(cwd, '.mcp.json'), 'mcp', cwd, false)
            }
          }

          contexts.set(ws, {
            ...existing,
            projectPath: message.projectPath || undefined,
            sessionId: nextSessionId,
            viewAgent: nextAgent,
          })

          // Track project path for OpenCode external tails
          if (nextAgent === 'opencode' && nextSessionId && message.projectPath) {
            ocSessionProjectPaths.set(nextSessionId, message.projectPath)
            if (DEBUG_RTS) {
              console.log(`[RTS] set_view: Stored projectPath for OpenCode session ${nextSessionId}: ${message.projectPath}`)
            }
          }

          const nextKey = makeSessionKey(nextAgent, nextSessionId)
          updateSessionWatchers(ws, prevKey, nextKey)
          
          if (DEBUG_RTS) {
            const watchers = sessionWatchers.get(nextKey ?? '')
            console.log(`[RTS] set_view: nextKey=${nextKey}, watchers=${watchers?.size ?? 0}`)
          }
          
          void sendStatus(ws)
          break
        }
        case 'pong': {
          const ctx = contexts.get(ws)
          if (!ctx) break
          ctx.lastPongAt = Date.now()
          ctx.lastRttMs = Math.max(0, ctx.lastPongAt - message.sentAt)
          if (ctx.pendingPing?.id === message.id) {
            ctx.pendingPing = undefined
          }
          if (ctx.connectionType === 'unknown') {
            ctx.connectionType = ctx.lastRttMs > 30 ? 'tailscale' : 'local'
          }
          send(ws, { type: 'connection_metrics', data: { rttMs: ctx.lastRttMs, lastPongAt: ctx.lastPongAt, connectionType: ctx.connectionType } })
          break
        }
        case 'client_ping': {
          // Client-initiated ping for app lifecycle detection - respond immediately
          send(ws, { type: 'client_pong', id: message.id, sentAt: message.sentAt, receivedAt: Date.now() })
          break
        }
        case 'list_projects': {
          const projects = await opencode.listProjects()
          reply({ type: 'projects', data: projects })
          break
        }
        case 'restart_opencode': {
          const ok = await options.restartOpenCode?.()
          reply({ type: 'opencode_restarted', data: ok === true })
          break
        }
        case 'list_sessions': {
          const sessions = await opencode.listSessions(message.projectPath)
          reply({ type: 'sessions', data: sessions, projectPath: message.projectPath })
          break
        }
        case 'list_providers': {
          const providers = await opencode.listProviders()
          reply({ type: 'providers', data: providers })
          break
        }
        case 'get_config': {
          // Use instance directory as fallback when no project is specified
          const projectPath = message.projectPath ?? await opencode.getInstanceDirectory()
          const config = await opencode.getConfig(projectPath ?? undefined)
          reply({ type: 'config', data: config })
          break
        }
        case 'set_config': {
          // Use instance directory as fallback when no project is specified
          const projectPath = message.projectPath ?? await opencode.getInstanceDirectory()
          const config = await opencode.updateConfig(message.config, projectPath ?? undefined)
          reply({ type: 'config', data: config })
          break
        }
        case 'set_model': {
          await opencode.updateModel(message.model, message.projectPath)
          const config = await opencode.getConfig(message.projectPath)
          reply({ type: 'config', data: config })
          break
        }
        case 'create_session': {
          const session = await opencode.createSession(
            message.projectPath,
            message.title,
            message.permission,
          )
          reply({ type: 'session_created', data: session })
          break
        }
        case 'get_session': {
          const session = await opencode.getSession(message.sessionId, message.projectPath)
          reply({ type: 'session', data: session })
          break
        }
        case 'get_session_messages': {
          const messages = await opencode.getSessionMessages(
            message.sessionId,
            message.projectPath,
            message.limit,
          )
          reply({ type: 'session_messages', data: messages, sessionId: message.sessionId })
          break
        }
        case 'chat': {
          const msgId = safeString((message as any).messageId)
          if (msgId) {
            const key = `${message.sessionId}:${msgId}`
            const now = Date.now()
            const previous = recentChatMessageIds.get(key)
            if (previous && now - previous < 120_000) {
              // Duplicate send of the same message (likely retry) — ignore.
              break
            }
            recentChatMessageIds.set(key, now)
            // Best-effort cleanup to keep memory bounded.
            if (recentChatMessageIds.size > 10_000) {
              const cutoff = now - 300_000
              for (const [k, t] of recentChatMessageIds) {
                if (t < cutoff) recentChatMessageIds.delete(k)
              }
            }
          }
          await opencode.sendPrompt(
            message.sessionId,
            message.content,
            message.projectPath,
            message.messageId,
            message.model,
            message.agent,
            message.disabledTools,
            message.fileAttachments,
            message.variant,
          )
          break
        }
        case 'abort': {
          await opencode.abortSession(message.sessionId, message.projectPath)
          break
        }
        case 'diff': {
          const diff = await opencode.getSessionDiff(
            message.sessionId,
            message.projectPath,
            message.messageId,
          )
          reply({ type: 'diff', data: diff, sessionId: message.sessionId })
          break
        }
        case 'browse': {
          // Use direct file listing (doesn't require OpenCode SDK)
          const items = await listFilesDirectly(message.path)
          reply({ type: 'browse_result', data: { path: message.path, items } })
          break
        }
        case 'permission_response': {
          // Use the new permission.reply() API - permissionId is now requestId
          await opencode.respondToPermission(
            message.permissionId,  // This is the requestID in the new API
            message.response,
            message.message,  // Optional rejection feedback message
            message.projectPath,
          )
          break
        }
        case 'get_lsp_status': {
          const lspStatus = await opencode.getLspStatus(message.projectPath)
          reply({ type: 'lsp_status', data: lspStatus })
          break
        }
        case 'get_session_context': {
          const context = await opencode.getSessionContext(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_context', data: context, sessionId: message.sessionId })
          break
        }
        // Feature 1: Todo/Plan Management
        case 'get_todos': {
          const todos = await opencode.getTodos(message.sessionId, message.projectPath)
          reply({ type: 'todos', data: todos, sessionId: message.sessionId })
          break
        }
        // Feature 2: Slash Commands
        case 'list_commands': {
          const commands = await opencode.listCommands(message.projectPath)
          reply({ type: 'commands', data: commands })
          break
        }
        case 'execute_command': {
          const result = await opencode.executeCommand(
            message.sessionId,
            message.command,
            message.arguments,
            message.projectPath,
            message.agent,
            message.model,
          )
          reply({ type: 'command_executed', data: result, sessionId: message.sessionId })
          break
        }
        // Feature 3: Agent Switching
        case 'list_agents': {
          const agents = await opencode.listAgents(message.projectPath)
          reply({ type: 'agents', data: agents })
          break
        }
        // Feature 4: Session Delete
        case 'delete_session': {
          const deleted = await opencode.deleteSession(message.sessionId, message.projectPath)
          reply({ type: 'session_deleted', data: deleted, sessionId: message.sessionId })
          break
        }
        // Feature 5: Session Update (Rename)
        case 'update_session': {
          const session = await opencode.updateSession(
            message.sessionId,
            message.title,
            message.archived,
            message.projectPath,
          )
          reply({ type: 'session_updated', data: session, sessionId: message.sessionId })
          break
        }
        // Feature 6: Session Fork
        case 'fork_session': {
          const session = await opencode.forkSession(
            message.sessionId,
            message.messageId,
            message.projectPath,
          )
          reply({ type: 'session_forked', data: session })
          break
        }
        // Feature 7: Message Revert (Undo)
        case 'revert_message': {
          const session = await opencode.revertMessage(
            message.sessionId,
            message.messageId,
            message.partId,
            message.projectPath,
          )
          reply({ type: 'message_reverted', data: session, sessionId: message.sessionId })
          break
        }
        case 'unrevert_session': {
          const session = await opencode.unrevertSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_unreverted', data: session, sessionId: message.sessionId })
          break
        }
        // Feature 8: Session Share
        case 'share_session': {
          const session = await opencode.shareSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_shared', data: session, sessionId: message.sessionId })
          break
        }
        case 'unshare_session': {
          const session = await opencode.unshareSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_unshared', data: session, sessionId: message.sessionId })
          break
        }
        // Feature 9: Session Summarize (Compact)
        case 'summarize_session': {
          const success = await opencode.summarizeSession(
            message.sessionId,
            message.providerID,
            message.modelID,
            message.projectPath,
          )
          reply({ type: 'session_summarized', data: success, sessionId: message.sessionId })
          break
        }
        // Feature 10: Git/VCS Information
        case 'get_vcs': {
          const vcs = await opencode.getVcsInfo(message.projectPath)
          reply({ type: 'vcs', data: vcs })
          break
        }
        // Feature 11: File Content Read
        case 'read_file': {
          const content = message.projectPath
            ? await opencode.readFile(message.path, message.projectPath)
            : await readFileDirectly(message.path)
          reply({ type: 'file_content', data: content, path: message.path })
          break
        }
        case 'read_file_binary': {
          const maxSizeMb = message.maxSizeMb ?? 10
          const result = await readFileBinaryDirectly(message.path, maxSizeMb)
          if ('error' in result) {
            if (result.error === 'too_large') {
              reply({ type: 'file_too_large', path: message.path, size: result.size ?? 0, maxSize: maxSizeMb * 1024 * 1024 })
            } else if (result.error === 'access_denied') {
              reply({ type: 'error', message: 'Access denied' })
            } else {
              reply({ type: 'error', message: 'File not found' })
            }
          } else {
            reply({ type: 'file_binary', data: result, path: message.path })
          }
          break
        }
        // Feature 12: File Search
        case 'find_files': {
          const files = await opencode.findFiles(message.query, message.projectPath)
          reply({ type: 'files_found', data: files })
          break
        }
        case 'find_text': {
          const results = await opencode.findText(message.pattern, message.include, message.projectPath)
          reply({ type: 'text_found', data: results })
          break
        }
        case 'find_symbols': {
          const symbols = await opencode.findSymbols(message.query, message.projectPath)
          reply({ type: 'symbols_found', data: symbols })
          break
        }
        case 'search_files_and_dirs': {
          // Use our unified file search module - works for both OpenCode and Claude Code
          // Falls back to OpenCode SDK if no projectPath is provided and OpenCode is running
          const cwd = message.projectPath
          
          if (cwd) {
            // Project path provided - use our file search module (faster, works for any directory)
            const results = await fileSearch.searchFilesAndDirs({
              query: message.query ?? '',
              cwd,
              limit: 50,
              includeDirs: true,
            })
            reply({ type: 'files_and_dirs_found', data: results })
          } else {
            // No project path - try OpenCode SDK (it uses its current working directory)
            const results = await opencode.searchFilesAndDirs(message.query, message.projectPath)
            reply({ type: 'files_and_dirs_found', data: results })
          }
          break
        }
        // Feature 13: Session Status
        case 'get_session_status': {
          const status = await opencode.getSessionStatus(message.projectPath)
          reply({ type: 'session_status', data: status })
          break
        }
        // Feature 14: PTY Terminal Sessions
        case 'list_pty': {
          try {
            log(`[PTY] Listing PTY sessions for projectPath: ${message.projectPath ?? '(none)'}`)
            const ptys = await opencode.listPty(message.projectPath)
            log(`[PTY] Found ${ptys.length} PTY sessions`)
            reply({ type: 'pty_list', data: ptys })
          } catch (error) {
            log(`[PTY] list_pty error: ${error}`)
            reply({ type: 'error', message: `PTY list failed: ${error}` })
          }
          break
        }
        case 'create_pty': {
          try {
            log(`[PTY] Creating PTY session: command=${message.command}, title=${message.title}, cwd=${message.cwd}, projectPath=${message.projectPath}`)
            const pty = await opencode.createPty(
              message.command,
              message.args,
              message.cwd,
              message.title,
              message.projectPath,
            )
            if (pty) {
              log(`[PTY] Created PTY session: ${JSON.stringify(pty)}`)
              reply({ type: 'pty_created', data: pty })
            } else {
              log(`[PTY] createPty returned null`)
              reply({ type: 'error', message: 'Failed to create PTY session - OpenCode returned null' })
            }
          } catch (error) {
            log(`[PTY] create_pty error: ${error}`)
            reply({ type: 'error', message: `PTY create failed: ${error}` })
          }
          break
        }
        case 'get_pty': {
          const pty = await opencode.getPty(message.ptyId, message.projectPath)
          if (pty) {
            reply({ type: 'pty', data: pty })
          } else {
            reply({ type: 'error', message: 'PTY session not found' })
          }
          break
        }
        case 'update_pty': {
          const pty = await opencode.updatePty(
            message.ptyId,
            message.title,
            message.rows,
            message.cols,
            message.projectPath,
          )
          if (pty) {
            reply({ type: 'pty_updated', data: pty })
          } else {
            reply({ type: 'error', message: 'Failed to update PTY session' })
          }
          break
        }
        case 'delete_pty': {
          const deleted = await opencode.deletePty(message.ptyId, message.projectPath)
          reply({ type: 'pty_deleted', data: deleted, ptyId: message.ptyId })
          break
        }
      case 'pty_connect': {
          const ptyId = message.ptyId
          getPtyListeners(ptyId).add(ws)
          const existingWs = ptyConnections.get(ptyId)
          if (existingWs) {
            reply({ type: 'pty_connected', ptyId })
            break
          }
          
          const ptyWsUrl = opencode.getPtyWebSocketUrl(ptyId, message.projectPath)
          
          try {
            const ptyWs = new WebSocket(ptyWsUrl)
            
            ptyWs.addEventListener('open', () => {
              ptyConnections.set(ptyId, ptyWs)
              ensurePtyHealth(ptyId)
              reply({ type: 'pty_connected', ptyId })
            })
            
            ptyWs.addEventListener('message', (event) => {
              const data = typeof event.data === 'string' ? event.data : event.data.toString()
              const health = ensurePtyHealth(ptyId)
              health.lastOutputTime = Date.now()
              health.bytesOut += data.length

              const buf = ensurePtyBuffer(ptyId)
              buf.buffer += data

              // Flush at ~60fps to avoid flooding clients.
              if (!buf.timer) {
                buf.timer = setTimeout(() => flushPtyOutput(ptyId), 16)
              }

              // Safety valve: if output is huge in one burst, flush early.
              if (buf.buffer.length >= 256 * 1024) {
                flushPtyOutput(ptyId)
              }
            })
            
            ptyWs.addEventListener('error', () => {
              const listeners = ptyListeners.get(ptyId)
              if (listeners && listeners.size > 0) {
                for (const client of listeners) {
                  send(client, { type: 'pty_error', ptyId, error: 'PTY connection failed' })
                }
              } else {
                send(ws, { type: 'pty_error', ptyId, error: 'PTY connection failed' })
              }
            })
            
            ptyWs.addEventListener('close', (event) => {
              ptyConnections.delete(ptyId)
              const buf = ptyOutputBuffers.get(ptyId)
              if (buf?.timer) clearTimeout(buf.timer)
              flushPtyOutput(ptyId)
              ptyOutputBuffers.delete(ptyId)

              ptyHealth.delete(ptyId)

              const listeners = ptyListeners.get(ptyId)
              if (listeners && listeners.size > 0) {
                for (const client of listeners) {
                  send(client, { type: 'pty_exit', ptyId, exitCode: event.code })
                }
              }
              ptyListeners.delete(ptyId)
            })
          } catch (error) {
            reply({ type: 'error', message: `PTY connect failed: ${error}` })
          }
          break
        }
        case 'pty_input': {
          const data = typeof message.data === 'string' ? message.data : ''
          if (data.length > 10000) {
            send(ws, { type: 'pty_error', ptyId: message.ptyId, error: 'Input too large (max 10KB)' })
            break
          }

          const health = ensurePtyHealth(message.ptyId)
          health.lastInputTime = Date.now()
          health.bytesIn += data.length

          const ptyWs = ptyConnections.get(message.ptyId)
          if (ptyWs && ptyWs.readyState === WebSocket.OPEN) {
            ptyWs.send(data)
          } else {
            send(ws, { type: 'pty_error', ptyId: message.ptyId, error: 'PTY is not connected' })
          }
          break
        }
        case 'pty_disconnect': {
          const listeners = ptyListeners.get(message.ptyId)
          listeners?.delete(ws)
          if (listeners && listeners.size === 0) {
            closePtyIfNoListeners(message.ptyId)
          }
          reply({ type: 'pty_disconnected', ptyId: message.ptyId })
          break
        }
        case 'pty_resize': {
          await opencode.updatePty(message.ptyId, undefined, message.rows, message.cols, message.projectPath)
          break
        }
        // Feature 15: MCP Server Management
        case 'get_mcp_status': {
          const status = await opencode.getMcpStatus(message.projectPath)
          reply({ type: 'mcp_status', data: status })
          break
        }
        case 'connect_mcp': {
          const connected = await opencode.connectMcp(message.name, message.projectPath)
          reply({ type: 'mcp_connected', data: connected, name: message.name })
          break
        }
        case 'disconnect_mcp': {
          const disconnected = await opencode.disconnectMcp(message.name, message.projectPath)
          reply({ type: 'mcp_disconnected', data: disconnected, name: message.name })
          break
        }
        case 'get_mcp_resources': {
          const resources = await opencode.getMcpResources(message.projectPath)
          reply({ type: 'mcp_resources', data: resources })
          break
        }
        // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
        case 'list_worktrees': {
          const worktrees = await opencode.listWorktrees(message.projectPath)
          reply({ type: 'worktrees', data: worktrees })
          break
        }
        case 'create_worktree': {
          const worktree = await opencode.createWorktree(
            message.name,
            message.startCommand,
            message.projectPath,
          )
          if (worktree) {
            reply({ type: 'worktree_created', data: worktree })
          } else {
            reply({ type: 'error', message: 'Failed to create worktree' })
          }
          break
        }
        case 'delete_worktree': {
          const deleted = await opencode.deleteWorktree(message.name, message.projectPath)
          reply({ type: 'worktree_deleted', data: deleted, name: message.name })
          break
        }
        // Feature 16: Full Provider Management
        case 'list_all_providers': {
          const providers = await opencode.listAllProviders(message.projectPath)
          reply({ type: 'all_providers', data: providers })
          break
        }
        case 'get_provider_auth': {
          const auth = await opencode.getProviderAuth(message.projectPath)
          reply({ type: 'provider_auth', data: auth })
          break
        }
        case 'set_api_key': {
          const success = await opencode.setApiKey(message.providerID, message.key, message.projectPath)
          reply({ type: 'api_key_set', data: success, providerID: message.providerID })
          break
        }
        // Feature 17: Tool List
        case 'list_tool_ids': {
          const toolIds = await opencode.listToolIds(message.projectPath)
          reply({ type: 'tool_ids', data: toolIds })
          break
        }
        case 'list_tools': {
          const tools = await opencode.listTools(message.provider, message.model, message.projectPath)
          reply({ type: 'tools', data: tools })
          break
        }
        // Feature 18: File Status (Git)
        case 'get_file_status': {
          const fileStatus = await opencode.getFileStatus(message.projectPath)
          reply({ type: 'file_status', data: fileStatus })
          break
        }
        // Feature 19: Formatter Status
        case 'get_formatter_status': {
          const formatterStatus = await opencode.getFormatterStatus(message.projectPath)
          reply({ type: 'formatter_status', data: formatterStatus })
          break
        }
        // Feature 20: Session Init
        case 'init_session': {
          const initialized = await opencode.initSession(
            message.sessionId,
            message.providerID,
            message.modelID,
            message.messageID,
            message.projectPath,
          )
          reply({ type: 'session_initialized', data: initialized, sessionId: message.sessionId })
          break
        }
        case 'dispose_instance': {
          const disposed = await opencode.disposeInstance(message.projectPath)
          reply({ type: 'instance_disposed', data: disposed })
          break
      }
      case 'cx_list_projects': {
        // FAST PATH: Read directly from filesystem (no app-server needed!)
        // Same pattern as Claude Code - instant file I/O instead of subprocess
        const now = Date.now()
        const forceRefresh = message.refresh === true
        
        // Check cache first (unless explicit refresh requested)
        if (!forceRefresh && cxProjectCache && (now - cxProjectCache.fetchedAt) < CODEX_PROJECT_CACHE_TTL_MS) {
          console.log('[cx_list_projects] Cache hit, returning cached data')
          reply({ type: 'cx_projects', data: cxProjectCache.data })
          break
        }
        
        console.log(`[cx_list_projects] ${forceRefresh ? 'Refresh requested' : 'Cache miss'}, reading from filesystem...`)
        const projects = await codexFs.listProjectsFromFs()
        
        // Update cache
        cxProjectCache = { data: projects, fetchedAt: Date.now() }
        console.log(`[cx_list_projects] Done, cached ${projects.length} projects (filesystem read)`)
        reply({ type: 'cx_projects', data: projects })
        break
      }
      case 'cx_list_threads': {
        // FAST PATH: Read directly from filesystem (no app-server needed!)
        // Same pattern as Claude Code - instant file I/O instead of subprocess
        const now = Date.now()
        const forceRefresh = message.refresh === true
        const cacheKey = message.cwd ? resolve(message.cwd) : '__all__'
        
        // Check cache first (unless explicit refresh or cursor-based pagination)
        const cached = cxThreadCache.get(cacheKey)
        if (!forceRefresh && !message.cursor && cached && (now - cached.fetchedAt) < CODEX_THREAD_CACHE_TTL_MS) {
          console.log(`[cx_list_threads] Cache hit for ${cacheKey}, returning cached data`)
          reply({ type: 'cx_threads', data: cached.data, nextCursor: cached.nextCursor })
          break
        }
        
        console.log(`[cx_list_threads] ${forceRefresh ? 'Refresh requested' : 'Cache miss'}, reading from filesystem...`)
        const threads = await codexFs.listThreadsFromFs(message.cwd ?? undefined)
        
        // Update cache (filesystem reads don't have pagination)
        cxThreadCache.set(cacheKey, { data: threads, fetchedAt: Date.now(), nextCursor: null })
        console.log(`[cx_list_threads] Done, cached ${threads.length} threads (filesystem read)`)
        reply({ type: 'cx_threads', data: threads, nextCursor: null })
        break
      }
      case 'cx_warmup': {
        // Pre-populate caches from filesystem for instant loading
        // No app-server spawn needed for listing - just file I/O
        console.log('[cx_warmup] Starting Codex warmup (filesystem)...')
        reply({ type: 'cx_warmup_started' })
        
        // Fire-and-forget: pre-warm caches from filesystem
        ;(async () => {
          try {
            // Pre-fetch projects from filesystem
            const projects = await codexFs.listProjectsFromFs()
            cxProjectCache = { data: projects, fetchedAt: Date.now() }
            console.log(`[cx_warmup] Pre-cached ${projects.length} projects from filesystem`)
            
            // Pre-fetch all threads from filesystem
            const threads = await codexFs.listThreadsFromFs()
            cxThreadCache.set('__all__', { data: threads, fetchedAt: Date.now(), nextCursor: null })
            console.log(`[cx_warmup] Pre-cached ${threads.length} threads from filesystem`)
          } catch (e) {
            console.error('[cx_warmup] Error:', e)
          }
        })()
        break
      }
      case 'cx_start_thread': {
        const client = await ensureCodexClient()
        const result: any = await client.request('thread/start', {
          cwd: message.cwd ?? null,
          model: message.model ?? null,
          approvalPolicy: message.approvalPolicy ?? null,
          sandbox: message.sandbox ?? null,
        })
        const thread = mapCodexThread(result?.thread)
        if (thread.id && thread.cwd) cxThreadCwds.set(thread.id, resolve(thread.cwd))
        // Invalidate caches since a new thread was created
        invalidateCodexCaches(thread.cwd)
        reply({ type: 'cx_thread_created', data: thread })
        break
      }
      case 'cx_resume_thread': {
        const client = await ensureCodexClient()
        const result: any = await client.request('thread/resume', {
          threadId: message.threadId,
        })
        const thread = mapCodexThread(result?.thread)
        if (thread.id && thread.cwd) cxThreadCwds.set(thread.id, resolve(thread.cwd))
        reply({ type: 'cx_thread', data: thread })
        break
      }
      case 'cx_archive_thread': {
        const client = await ensureCodexClient()
        // Get the thread's cwd before archiving (for cache invalidation)
        const archivedCwd = cxThreadCwds.get(message.threadId)
        await client.request('thread/archive', { threadId: message.threadId })
        // Invalidate caches since a thread was archived
        invalidateCodexCaches(archivedCwd)
        reply({ type: 'cx_thread_archived', data: true, threadId: message.threadId })
        break
      }
      case 'cx_get_thread_messages': {
        // FAST PATH: Read messages directly from filesystem (no app-server needed!)
        // Same pattern as listing - instant file I/O instead of slow subprocess
        console.log(`[cx_get_thread_messages] Reading messages for thread ${message.threadId} from filesystem...`)
        const transcript = await codexFs.getThreadMessagesFromFs(message.threadId)
        console.log(`[cx_get_thread_messages] Found ${transcript.length} messages`)
        reply({
          type: 'cx_thread_messages',
          data: transcript,
          threadId: message.threadId,
        })
        break
      }
      case 'cx_model_list': {
        const client = await ensureCodexClient()
        const result: any = await client.request('model/list', {
          cursor: null,
          limit: 200,
        })
        reply({
          type: 'cx_models',
          data: result?.data ?? [],
          nextCursor: result?.nextCursor ?? null,
        })
        break
      }
      case 'cx_skills_list': {
        const client = await ensureCodexClient()
        const cwds = message.cwd ? [message.cwd] : []
        const result: any = await client.request('skills/list', {
          cwds,
          forceReload: message.forceReload === true,
        })
        reply({ type: 'cx_skills', data: result?.data ?? [] })
        break
      }
      case 'cx_get_skill': {
        const skillFiles = await import('./skills')
        if (!skillFiles.validateSkillName(message.name)) {
          reply({ type: 'error', message: 'Invalid skill name' })
          break
        }
        const path = skillFiles.getCodexSkillFilePath({
          name: message.name,
          scope: message.scope,
          cwd: message.cwd,
        })
        try {
          const content = await skillFiles.readSkillFile(path)
          reply({
            type: 'cx_skill',
            data: { name: message.name, path, scope: message.scope, content },
          })
        } catch {
          reply({ type: 'error', message: 'Skill not found' })
        }
        break
      }
      case 'cx_save_skill': {
        const skillFiles = await import('./skills')
        if (!skillFiles.validateSkillName(message.name)) {
          reply({ type: 'cx_skill_saved', data: { ok: false } })
          break
        }
        const path = skillFiles.getCodexSkillFilePath({
          name: message.name,
          scope: message.scope,
          cwd: message.cwd,
        })
        try {
          await skillFiles.writeSkillFile(path, message.content)
          reply({ type: 'cx_skill_saved', data: { ok: true, path } })
        } catch {
          reply({ type: 'cx_skill_saved', data: { ok: false } })
        }
        break
      }
      case 'cx_delete_skill': {
        const skillFiles = await import('./skills')
        if (!skillFiles.validateSkillName(message.name)) {
          reply({ type: 'cx_skill_deleted', data: { ok: false } })
          break
        }
        const path = skillFiles.getCodexSkillFilePath({
          name: message.name,
          scope: message.scope,
          cwd: message.cwd,
        })
        try {
          await skillFiles.deleteSkillByPath(path)
          reply({ type: 'cx_skill_deleted', data: { ok: true } })
        } catch {
          reply({ type: 'cx_skill_deleted', data: { ok: false } })
        }
        break
      }
      case 'cx_config_read': {
        const client = await ensureCodexClient()
        const result: any = await client.request('config/read', {
          includeLayers: false,
        })
        reply({ type: 'cx_config', data: result ?? {} })
        break
      }
      case 'cx_config_value_write': {
        const client = await ensureCodexClient()
        const mergeStrategyRaw = safeString(message.mergeStrategy)
        const mergeStrategy =
          mergeStrategyRaw.toLowerCase() === 'upsert'
            ? 'Upsert'
            : mergeStrategyRaw.toLowerCase() === 'replace'
              ? 'Replace'
              : 'Replace'
        const result: any = await client.request('config/value/write', {
          keyPath: message.keyPath,
          value: message.value,
          mergeStrategy,
          filePath: null,
          expectedVersion: null,
        })
        reply({ type: 'cx_config_written', data: result ?? {} })
        break
      }
      case 'cx_mcp_status_list': {
        const client = await ensureCodexClient()
        const result: any = await client.request('mcpServerStatus/list', {
          cursor: message.cursor ?? null,
          limit: message.limit ?? 200,
        })
        reply({
          type: 'cx_mcp_status',
          data: result?.data ?? [],
          nextCursor: result?.nextCursor ?? null,
        })
        break
      }
      case 'cx_mcp_oauth_login': {
        const client = await ensureCodexClient()
        const result: any = await client.request('mcpServer/oauth/login', {
          name: message.name,
          scopes: message.scopes ?? null,
          timeoutSecs: message.timeoutSecs ?? null,
        })
        reply({ type: 'cx_mcp_oauth', data: result ?? {} })
        break
      }
      // Codex MCP Hot Reload (SDK feature) - reloads MCP server config without restarting
      case 'cx_mcp_reload': {
        const client = await ensureCodexClient()
        const result: any = await client.request('config/mcpServer/reload', {})
        reply({ type: 'cx_mcp_reloaded', data: result ?? {} })
        break
      }
      case 'cx_review_start': {
        const client = await ensureCodexClient()
        const cwd = message.cwd ?? process.cwd()

        let threadId = message.threadId
        if (!threadId) {
          const startRes: any = await client.request('thread/start', {
            cwd,
            model: message.model ?? null,
            approvalPolicy: message.approvalPolicy ?? null,
            sandbox: message.sandbox ?? null,
            config: message.config ?? null,
          })
          threadId = safeString(startRes?.thread?.id)
          if (threadId) {
            reply({ type: 'cx_thread_created', data: mapCodexThread(startRes.thread) })
            cxThreadCwds.set(threadId, resolve(cwd))
          }
        } else {
          await client.request('thread/resume', {
            threadId,
            model: message.model ?? null,
            cwd,
            approvalPolicy: message.approvalPolicy ?? null,
            sandbox: message.sandbox ?? null,
            config: message.config ?? null,
          })
        }

        if (!threadId) {
          reply({ type: 'error', message: 'Failed to create/resume Codex thread for review' })
          break
        }

        cxThreadOwners.set(threadId, ws)

        const target = message.target ?? { type: 'uncommittedChanges' }
        const delivery = message.delivery ?? 'inline'
        const res: any = await client.request('review/start', {
          threadId,
          target,
          delivery,
        })
        const reviewThreadId = safeString(res?.reviewThreadId ?? res?.review_thread_id) || threadId
        const turnId = safeString(res?.turn?.id)
        if (reviewThreadId) cxThreadOwners.set(reviewThreadId, ws)
        if (turnId && reviewThreadId) cxActiveTurns.set(reviewThreadId, turnId)
        reply({
          type: 'cx_review_started',
          data: { threadId, reviewThreadId, turnId },
        })
        break
      }
      case 'cx_account_read': {
        const client = await ensureCodexClient()
        const result: any = await client.request('account/read', {
          refreshToken: message.refreshToken === true,
        })
        reply({ type: 'cx_account', data: result ?? {} })
        break
      }
      case 'cx_login_start': {
        const client = await ensureCodexClient()
        const loginType = message.loginType
        const params =
          loginType === 'apiKey'
            ? { type: 'apiKey', apiKey: message.apiKey ?? '' }
            : { type: 'chatgpt' }
        const result: any = await client.request('account/login/start', params)
        reply({ type: 'cx_login_started', data: result ?? {} })
        break
      }
      case 'cx_login_cancel': {
        const client = await ensureCodexClient()
        const result: any = await client.request('account/login/cancel', {
          loginId: message.loginId,
        })
        reply({ type: 'cx_login_canceled', data: result ?? {} })
        break
      }
      case 'cx_logout': {
        const client = await ensureCodexClient()
        const result: any = await client.request('account/logout')
        reply({ type: 'cx_logged_out', data: result ?? {} })
        break
      }
      case 'cx_rate_limits_read': {
        const client = await ensureCodexClient()
        const result: any = await client.request('account/rateLimits/read')
        reply({ type: 'cx_rate_limits', data: result ?? {} })
        break
      }
      case 'cx_feedback_upload': {
        const client = await ensureCodexClient()
        const result: any = await client.request('feedback/upload', {
          classification: message.classification,
          reason: message.reason ?? null,
          threadId: message.threadId ?? null,
          includeLogs: message.includeLogs === true,
        })
        reply({ type: 'cx_feedback_uploaded', data: result ?? {} })
        break
      }
      case 'cx_undo_files': {
        const threadId = safeString(message.threadId)
        if (!threadId) {
          reply({
            type: 'cx_undo_result',
            data: { ok: false, revertedPaths: [], error: 'Missing threadId' },
          })
          break
        }
        const stack = ensureUndoStack(threadId)
        const count = Math.max(1, Number(message.count ?? 1) || 1)
        if (stack.length === 0) {
          reply({ type: 'cx_undo_result', data: { ok: true, revertedPaths: [] } })
          break
        }
        const keys = stack.slice(-count)
        const revertedAll: string[] = []
        try {
          for (const key of keys.reverse()) {
            const reverted = await applyCodexUndo(threadId, key)
            revertedAll.push(...reverted)
          }
          reply({ type: 'cx_undo_result', data: { ok: true, revertedPaths: revertedAll } })
        } catch (err: any) {
          reply({
            type: 'cx_undo_result',
            data: {
              ok: false,
              revertedPaths: revertedAll,
              error: err?.message ?? String(err),
            },
          })
        }
        break
      }
      case 'cx_agents_read': {
        const cwd = resolve(message.cwd)
        const agentsPath = resolve(cwd, 'AGENTS.md')
        try {
          const content = await readFile(agentsPath, 'utf8')
          reply({
            type: 'cx_agents',
            data: { exists: true, path: agentsPath, content },
          })
        } catch {
          reply({
            type: 'cx_agents',
            data: { exists: false, path: agentsPath, content: '' },
          })
        }
        break
      }
      case 'cx_agents_write': {
        const cwd = resolve(message.cwd)
        const agentsPath = resolve(cwd, 'AGENTS.md')
        try {
          await writeFile(agentsPath, message.content ?? '', 'utf8')
          reply({
            type: 'cx_agents_written',
            data: { ok: true, path: agentsPath },
          })
        } catch {
          reply({
            type: 'cx_agents_written',
            data: { ok: false, path: agentsPath },
          })
        }
        break
      }
      case 'cx_chat': {
        const client = await ensureCodexClient()
        const cwd = message.cwd ?? process.cwd()

        let threadId = message.threadId
        if (!threadId) {
          const startRes: any = await client.request('thread/start', {
            cwd,
            model: message.model ?? null,
            approvalPolicy: message.approvalPolicy ?? null,
            sandbox: message.sandbox ?? null,
            config: message.config ?? null,
            baseInstructions: message.baseInstructions ?? null,
            developerInstructions: message.developerInstructions ?? null,
          })
          threadId = safeString(startRes?.thread?.id)
          if (threadId) {
            reply({ type: 'cx_thread_created', data: mapCodexThread(startRes.thread) })
          }
        } else {
          // Ensure we are subscribed to events for this thread.
          await client.request('thread/resume', {
            threadId,
            model: message.model ?? null,
            cwd,
            approvalPolicy: message.approvalPolicy ?? null,
            sandbox: message.sandbox ?? null,
            config: message.config ?? null,
            baseInstructions: message.baseInstructions ?? null,
            developerInstructions: message.developerInstructions ?? null,
          })
        }

          if (!threadId) {
            send(ws, {
              type: 'cx_stream',
              threadId: 'unknown',
              data: { type: 'error', message: 'Failed to create/resume Codex thread' },
            })
            break
          }

          cxThreadOwners.set(threadId, ws)
          cxThreadCwds.set(threadId, resolve(cwd))

        // Prepare input (text + optional local images written to disk).
        const input: Array<any> = [{ type: 'text', text: message.prompt }]
        if (message.fileAttachments && message.fileAttachments.length > 0) {
          const attachmentsDir = resolve(cwd, '.broski', 'codex-attachments')
          await mkdir(attachmentsDir, { recursive: true })
          for (const a of message.fileAttachments) {
            if (a.base64Data && a.mimeType) {
              const token = randomBytes(6).toString('hex')
              const ext = a.mimeType.includes('png')
                ? '.png'
                : a.mimeType.includes('webp')
                  ? '.webp'
                  : '.jpg'
              const fileName = `${Date.now()}_${token}${ext}`
              const outPath = resolve(attachmentsDir, fileName)
              await writeFile(outPath, Buffer.from(a.base64Data, 'base64'))
              input.push({ type: 'localImage', path: outPath })
            } else if (a.path) {
              // File/directory references via prompt hint
              const ref = a.path.startsWith('@') ? a.path : `@${a.path}`
              input[0].text = `${input[0].text}\n\nAttached context (via Broski):\n- ${a.isDirectory ? 'Directory' : 'File'}: ${ref}`
            }
          }
        }

        // Build collaboration mode object if specified (SDK v0.87.0+)
        // Format: { mode: "plan"|"pairprogramming"|"execute", model: string, reasoningEffort?: string }
        let collaborationMode: any = null
        if (message.collaborationMode) {
          collaborationMode = {
            mode: message.collaborationMode,
            model: message.model ?? 'gpt-4.1', // Fallback model
            reasoningEffort: message.effort ?? null,
            developerInstructions: message.developerInstructions ?? null,
          }
        }

        const turnRes: any = await client.request('turn/start', {
          threadId,
          input,
          cwd,
          model: message.model ?? null,
          effort: message.effort ?? null,
          summary: message.summary ?? null,
          approvalPolicy: message.approvalPolicy ?? null,
          sandboxPolicy: message.sandboxPolicy ?? null,
          collaborationMode,
        })

        const turnId = safeString(turnRes?.turn?.id)
        if (turnId) cxActiveTurns.set(threadId, turnId)
        break
      }
      case 'cx_abort': {
        const client = await ensureCodexClient()
        const turnId = message.turnId ?? cxActiveTurns.get(message.threadId)
        if (turnId) {
          await client.request('turn/interrupt', {
            threadId: message.threadId,
            turnId,
          })
        }
        break
      }
      case 'cx_thread_fork': {
        const client = await ensureCodexClient()
        const result: any = await client.request('thread/fork', {
          threadId: message.threadId,
        })
        const thread = result?.thread
        if (thread) {
          const id = safeString(thread?.id)
          if (id) {
            cxThreadOwners.set(id, ws)
            const cwd = safeString(thread?.cwd)
            if (cwd) cxThreadCwds.set(id, resolve(cwd))
          }
          reply({ type: 'cx_thread_forked', data: mapCodexThread(thread) })
        } else {
          reply({ type: 'error', message: 'Fork failed' })
        }
        break
      }
      case 'cx_thread_rollback': {
        const client = await ensureCodexClient()
        const result: any = await client.request('thread/rollback', {
          threadId: message.threadId,
          numTurns: message.numTurns,
        })
        const thread = result?.thread
        if (thread) {
          reply({ type: 'cx_thread_rolled_back', data: mapCodexThread(thread) })
        } else {
          reply({ type: 'error', message: 'Rollback failed' })
        }
        break
      }
      case 'cx_permission_response': {
        const waiter = cxApprovalWaiters.get(message.requestId)
        if (waiter) {
          clearTimeout(waiter.timer)
          cxApprovalWaiters.delete(message.requestId)
          waiter.resolve({
            response: message.response,
            execpolicyAmendment: (message as any).execpolicyAmendment,
          })
        }
        break
      }
      case 'cx_user_input_response': {
        // Codex request_user_input response (SDK v0.87.0+)
        const waiter = cxApprovalWaiters.get(message.requestId)
        if (waiter) {
          clearTimeout(waiter.timer)
          cxApprovalWaiters.delete(message.requestId)
          waiter.resolve({ answers: message.answers })
        }
        break
      }
      case 'set_agent': {
          currentAgent = message.agent
          log(`Agent switched to: ${currentAgent}`)
          if (currentAgent === 'claude-code') {
            const ctx = contexts.get(ws)
            const cwd = ctx?.projectPath && ctx.projectPath !== 'global' ? ctx.projectPath : undefined
            if (cwd) {
              ensureClaudeWatchDir(join(cwd, '.claude', 'skills'), 'skills', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'plugins'), 'plugins', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'commands'), 'commands', cwd)
              ensureClaudeWatchDir(join(cwd, '.claude', 'hooks'), 'hooks', cwd)
              ensureClaudeWatchDir(join(cwd, '.mcp.json'), 'mcp', cwd, false)
            }
            const envKey = !!process.env.ANTHROPIC_API_KEY
            const available = await claudeCode.checkClaudeCodeAvailable()
            log(
              `[Claude Code] Auth: ${
                available ? 'OK' : 'MISSING'
              } (${envKey ? 'ANTHROPIC_API_KEY' : '~/.claude/settings.json'})`,
            )
            if (!available) {
              log(
                `[Claude Code] Set ANTHROPIC_API_KEY or run 'claude login' on this machine before using Claude Code from Broski.`,
              )
            }
          }
          if (currentAgent === 'codex') {
            const available = await checkCodexAvailable()
            log(`[Codex] ${available ? 'OK' : 'MISSING'} (requires 'codex' in PATH)`)
          }
          break
        }
        case 'get_agents_status': {
          const opencodeRunning = await opencode.isRunning()
          const claudeCodeAvailable = await claudeCode.checkClaudeCodeAvailable()
          const codexAvailable = await checkCodexAvailable()
          reply({
            type: 'agents_status',
            data: {
              opencode: {
                available: opencodeRunning,
                version: version,
              },
              'claude-code': {
                available: claudeCodeAvailable,
                authMethod: claudeCodeAvailable ? 'api-key' : undefined,
              },
              codex: {
                available: codexAvailable,
                authMethod: codexAvailable ? 'cli' : undefined,
              },
            },
          })
          break
        }
        case 'oc_question_reply': {
          const ok = await opencode.replyToQuestion(message.questionId, message.answers)
          reply({ type: 'oc_question_replied', data: ok })
          break
        }
        case 'oc_question_reject': {
          const ok = await opencode.rejectQuestion(message.questionId)
          reply({ type: 'oc_question_rejected', data: ok })
          break
        }
        case 'oc_list_skills': {
          const skillFiles = await import('./skills')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await opencode.getInstanceDirectory()
          const data = await skillFiles.listOpenCodeSkills(cwd ?? undefined)
          reply({ type: 'oc_skills', data })
          break
        }
        case 'oc_get_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'error', message: 'Invalid skill name' })
            break
          }
          const path = skillFiles.getOpenCodeSkillFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            const content = await skillFiles.readSkillFile(path)
            reply({
              type: 'oc_skill',
              data: { name: message.name, path, source: message.source, content },
            })
          } catch {
            reply({ type: 'error', message: 'Skill not found' })
          }
          break
        }
        case 'oc_save_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'oc_skill_saved', data: { ok: false } })
            break
          }
          const path = skillFiles.getOpenCodeSkillFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await skillFiles.writeSkillFile(path, message.content)
            reply({ type: 'oc_skill_saved', data: { ok: true, path } })
          } catch {
            reply({ type: 'oc_skill_saved', data: { ok: false } })
          }
          break
        }
        case 'oc_delete_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'oc_skill_deleted', data: { ok: false } })
            break
          }
          const path = skillFiles.getOpenCodeSkillFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await skillFiles.deleteSkillByPath(path)
            reply({ type: 'oc_skill_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'oc_skill_deleted', data: { ok: false } })
          }
          break
        }
        case 'oc_list_plugin_files': {
          const plugins = await import('./opencode-plugins')
          const data = await plugins.listPluginFiles(message.cwd)
          reply({ type: 'oc_plugin_files', data })
          break
        }
        case 'oc_get_plugin_file': {
          const plugins = await import('./opencode-plugins')
          if (!plugins.validatePluginFilename(message.name)) {
            reply({ type: 'error', message: 'Invalid plugin filename' })
            break
          }
          const path = plugins.getPluginFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            const content = await plugins.readPluginFile(path)
            reply({
              type: 'oc_plugin_file',
              data: { name: message.name, path, source: message.source, content },
            })
          } catch {
            reply({ type: 'error', message: 'Plugin file not found' })
          }
          break
        }
        case 'oc_save_plugin_file': {
          const plugins = await import('./opencode-plugins')
          if (!plugins.validatePluginFilename(message.name)) {
            reply({ type: 'oc_plugin_file_saved', data: { ok: false } })
            break
          }
          const path = plugins.getPluginFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await plugins.writePluginFile(path, message.content)
            reply({ type: 'oc_plugin_file_saved', data: { ok: true, path } })
          } catch {
            reply({ type: 'oc_plugin_file_saved', data: { ok: false } })
          }
          break
        }
        case 'oc_delete_plugin_file': {
          const plugins = await import('./opencode-plugins')
          if (!plugins.validatePluginFilename(message.name)) {
            reply({ type: 'oc_plugin_file_deleted', data: { ok: false } })
            break
          }
          const path = plugins.getPluginFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await plugins.deletePluginFile(path)
            reply({ type: 'oc_plugin_file_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'oc_plugin_file_deleted', data: { ok: false } })
          }
          break
        }
        case 'oc_list_command_files': {
          const files = await import('./opencode-custom')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await opencode.getInstanceDirectory()
          const data = await files.listCommandFiles(cwd ?? undefined)
          reply({ type: 'oc_command_files', data })
          break
        }
        case 'oc_get_command_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'error', message: 'Invalid command name' })
            break
          }
          const path = files.commandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            const content = await files.readMarkdownFile(path)
            reply({ type: 'oc_command_file', data: { name: message.name, path, source: message.source, content } })
          } catch {
            reply({ type: 'error', message: 'Command file not found' })
          }
          break
        }
        case 'oc_save_command_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'oc_command_file_saved', data: { ok: false } })
            break
          }
          const path = files.commandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            await files.writeMarkdownFile(path, message.content)
            reply({ type: 'oc_command_file_saved', data: { ok: true, path } })
          } catch {
            reply({ type: 'oc_command_file_saved', data: { ok: false } })
          }
          break
        }
        case 'oc_delete_command_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'oc_command_file_deleted', data: { ok: false } })
            break
          }
          const path = files.commandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            await files.deleteMarkdownFile(path)
            reply({ type: 'oc_command_file_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'oc_command_file_deleted', data: { ok: false } })
          }
          break
        }
        case 'oc_list_agent_files': {
          const files = await import('./opencode-custom')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await opencode.getInstanceDirectory()
          const data = await files.listAgentFiles(cwd ?? undefined)
          reply({ type: 'oc_agent_files', data })
          break
        }
        case 'oc_get_agent_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'error', message: 'Invalid agent name' })
            break
          }
          const path = files.agentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            const content = await files.readMarkdownFile(path)
            reply({ type: 'oc_agent_file', data: { name: message.name, path, source: message.source, content } })
          } catch {
            reply({ type: 'error', message: 'Agent file not found' })
          }
          break
        }
        case 'oc_save_agent_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'oc_agent_file_saved', data: { ok: false } })
            break
          }
          const path = files.agentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            await files.writeMarkdownFile(path, message.content)
            reply({ type: 'oc_agent_file_saved', data: { ok: true, path } })
          } catch {
            reply({ type: 'oc_agent_file_saved', data: { ok: false } })
          }
          break
        }
        case 'oc_delete_agent_file': {
          const files = await import('./opencode-custom')
          if (!files.validateName(message.name)) {
            reply({ type: 'oc_agent_file_deleted', data: { ok: false } })
            break
          }
          const path = files.agentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            await files.deleteMarkdownFile(path)
            reply({ type: 'oc_agent_file_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'oc_agent_file_deleted', data: { ok: false } })
          }
          break
        }
        case 'cc_list_projects': {
          const projects = await claudeCode.listProjects()
          reply({ type: 'cc_projects', data: projects })
          break
        }
        case 'cc_list_sessions': {
          const sessions = await claudeCode.listSessions(message.cwd)
          reply({ type: 'cc_sessions', data: sessions })
          break
        }
        case 'cc_get_session': {
          const session = await claudeCode.getSession(message.sessionId, message.cwd)
          if (session) {
            reply({ type: 'cc_session', data: session })
          } else {
            reply({ type: 'error', message: 'Session not found' })
          }
          break
        }
        case 'cc_get_session_messages': {
          const items = await claudeCode.getSessionMessages(
            message.sessionId,
            message.cwd,
            message.limit,
          )
          reply({
            type: 'cc_session_messages',
            data: items,
            sessionId: message.sessionId,
          })
          break
        }
        case 'cc_delete_session': {
          const deleted = await claudeCode.deleteSession(message.sessionId, message.cwd)
          reply({ type: 'cc_session_deleted', data: deleted, sessionId: message.sessionId })
          break
        }
        case 'cc_fork_session': {
          const forked = await claudeCode.forkSession(message.sessionId, message.messageId, message.cwd)
          reply({ type: 'cc_session_forked', data: forked })
          break
        }
        case 'cc_chat': {
          const cwd = message.cwd || process.cwd()
          let actualSessionId = message.sessionId ?? ''
          const cfg = await claudeCode.getConfig(cwd)
          const model = message.model || cfg.model || 'sonnet'
          const permissionMode = message.permissionMode || cfg.permissionMode
          const allowedTools = message.allowedTools || cfg.allowedTools
          const disallowedTools = message.disallowedTools || cfg.disallowedTools
          // Stable per-turn identifier so watchers on other devices can keep CC turns separated.
          const ccMessageId = `cc-msg-${randomBytes(8).toString('hex')}`
          const toolCallsById = new Map<string, { tool: string; input: Record<string, unknown> }>()
          let sentBusyStatus = false

          if (message.sessionId) {
            ccSessionOwners.set(message.sessionId, ws)
          }

          const sendSessionBusy = (sessionId: string) => {
            if (!sessionId || sentBusyStatus) return
            sentBusyStatus = true
            send(ws, {
              type: 'sdk_event',
              data: {
                payload: {
                  type: 'session.status',
                  properties: {
                    sessionID: sessionId,
                    status: { type: 'busy' },
                  },
                },
              },
            })
          }

          const sendSessionIdle = (sessionId: string) => {
            if (!sessionId) return
            send(ws, {
              type: 'sdk_event',
              data: {
                payload: {
                  type: 'session.idle',
                  properties: {
                    sessionID: sessionId,
                  },
                },
              },
            })
          }

          const available = await claudeCode.checkClaudeCodeAvailable()
          if (!available) {
            const err = 'Claude Code auth not configured (set ANTHROPIC_API_KEY or run `claude login`).'
            log(`[Claude Code] ${err}`)
            const sid = actualSessionId || message.sessionId || ''
            if (sid) {
              emitCcStream(sid, { type: 'error', message: err, code: 'cc_auth_missing' }, ws)
            } else {
              send(ws, {
                type: 'cc_stream',
                data: { type: 'error', message: err, code: 'cc_auth_missing' },
                sessionId: 'unknown',
              })
            }
            break
          }

          log(
            `[Claude Code] chat: ${message.sessionId ? 'resume' : 'new'} cwd=${cwd} model=${model} permissionMode=${permissionMode}`,
          )
          log(
            `[Claude Code] tools: allowed=${allowedTools.length} disallowed=${disallowedTools.length}`,
          )

          const prompt = await claudeCode.preparePromptWithAttachments(
            message.prompt,
            cwd,
            message.fileAttachments,
          )

          // If we're resuming an existing session, mark it busy immediately.
          // For new sessions, we'll mark busy once we receive session-created.
          if (message.sessionId) {
            sendSessionBusy(message.sessionId)
          }

          claudeCode.queryClaudeCode(
            prompt,
            {
              cwd,
              sessionId: message.sessionId,
              model,
              permissionMode,
              allowedTools,
              disallowedTools,
              maxThinkingTokens: message.maxThinkingTokens,
              variant: message.variant,
              systemPrompt: message.systemPrompt ?? cfg.systemPrompt,
              activeSubagent: message.activeSubagent,
            },
            (streamMsg) => {
              const streamMsgWithId = (() => {
                const t = (streamMsg as any)?.type
                if (
                  t === 'assistant-message' ||
                  t === 'assistant-message-delta' ||
                  t === 'thinking-delta' ||
                  t === 'tool-call' ||
                  t === 'tool-result' ||
                  t === 'subagent-invocation' ||
                  t === 'token-usage'
                ) {
                  return { ...(streamMsg as any), messageId: ccMessageId }
                }
                return streamMsg
              })()
              if ((streamMsg as any)?.type === 'session-created' && typeof (streamMsg as any)?.sessionId === 'string') {
                actualSessionId = (streamMsg as any).sessionId
                ccSessionOwners.set(actualSessionId, ws)
                log(`[Claude Code] session created: ${actualSessionId}`)
                sendSessionBusy(actualSessionId)
              }

              // Track tool calls quickly (needed for later tool-result indexing).
              try {
                if ((streamMsgWithId as any)?.type === 'tool-call') {
                  const toolUseId = safeString((streamMsgWithId as any)?.toolUseId)
                  const tool = safeString((streamMsgWithId as any)?.tool)
                  const inputRaw = (streamMsgWithId as any)?.input
                  const input = (inputRaw && typeof inputRaw === 'object') ? (inputRaw as Record<string, unknown>) : {}
                  if (toolUseId) toolCallsById.set(toolUseId, { tool, input })
                }
              } catch (err) {
                console.warn('[Artifacts] Failed to track Claude Code tool call:', err)
              }

              if (actualSessionId) {
                emitCcStream(actualSessionId, streamMsgWithId, ws)
              } else {
                send(ws, { type: 'cc_stream', data: streamMsgWithId, sessionId: 'unknown' })
              }

              // Artifact indexing (Claude Code): keep streaming hot path fast.
              // Queue heavier work after sending the stream message.
              // TODO(artifacts): Re-enable when feature is ready
              if (ARTIFACTS_ENABLED) {
                queueMicrotask(() => {
                  try {
                    if ((streamMsgWithId as any)?.type !== 'tool-result') return
                    const toolUseId = safeString((streamMsgWithId as any)?.toolUseId)
                    const toolUseResult = (streamMsgWithId as any)?.toolUseResult
                    const toolCall = toolUseId ? toolCallsById.get(toolUseId) : null
                    const tool = toolCall?.tool ?? ''
                    const filePath = safeString(toolUseResult?.filePath)

                    if (!toolUseId || !filePath) return

                    const isFileWriteTool =
                      tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'Patch' || tool === 'NotebookEdit'
                    if (!isFileWriteTool) return

                    const structuredPatch = toolUseResult?.structuredPatch
                    const unifiedDiff = structuredPatchToUnifiedDiff(filePath, structuredPatch)

                    artifactIndex?.enqueue({
                      backend: 'claude-code',
                      sessionId: actualSessionId || message.sessionId || '',
                      messageId: null,
                      toolUseId,
                      projectPath: cwd,
                      gitBranch: null,
                      tool,
                      toolInput: toolCall?.input ?? {},
                      toolOutput: null,
                      filePath,
                      contentBefore: safeString(toolUseResult?.oldString) || safeString(toolUseResult?.originalFile) || null,
                      contentAfter: safeString(toolUseResult?.newString) || safeString(toolUseResult?.content) || null,
                      unifiedDiff,
                      timestamp: Date.now(),
                    })
                  } catch (err) {
                    console.warn('[Artifacts] Failed to enqueue Claude Code artifact:', err)
                  }
                })
              }
            },
            (completedSessionId) => {
              const sid = completedSessionId || actualSessionId || message.sessionId || ''
              log(`Claude Code session ${sid} completed`)
              sendSessionIdle(sid)
              if (sid && ccSessionOwners.get(sid) === ws) {
                ccSessionOwners.delete(sid)
                syncExternalTailForKey(makeSessionKey('claude-code', sid))
              }
              // TODO(artifacts): Re-enable when feature is ready
              if (ARTIFACTS_ENABLED) {
                if (sid) artifactsEnrichment?.queueArtifactsEnrichmentForSession(sid)
              }
            },
            (error) => {
              log(`[Claude Code] error: ${error.message}`)
              const sid = actualSessionId || message.sessionId || ''
              if (sid) {
                emitCcStream(sid, { type: 'error', message: error.message, code: 'cc_error' }, ws)
              } else {
                send(ws, {
                  type: 'cc_stream',
                  data: { type: 'error', message: error.message, code: 'cc_error' },
                  sessionId: 'unknown',
                })
              }
              sendSessionIdle(sid)
              if (sid && ccSessionOwners.get(sid) === ws) {
                ccSessionOwners.delete(sid)
                syncExternalTailForKey(makeSessionKey('claude-code', sid))
              }
            },
            async (req) => {
              const sid = req.sessionId || actualSessionId
              if (sid) actualSessionId = sid
              if (sid) ccSessionOwners.set(sid, ws)

              // Ask the requesting socket for approval (mobile UI shows prompt)
              send(ws, {
                type: 'cc_stream',
                data: {
                  type: 'permission-request',
                  sessionId: sid,
                  toolUseId: req.toolUseId,
                  tool: req.tool,
                  input: req.input,
                  decisionReason: req.decisionReason,
                  blockedPath: req.blockedPath,
                  hasSuggestions: req.hasSuggestions,
                },
                sessionId: sid,
              })

              // Wait for a response from the client
              const key = `${sid}:${req.toolUseId}`
              const existing = ccPermissionWaiters.get(key)
              if (existing) {
                // If we somehow re-request, default to deny to avoid deadlocks
                return 'reject'
              }

              return await new Promise<'once' | 'always' | 'reject'>((resolve) => {
                const timer = setTimeout(() => {
                  ccPermissionWaiters.delete(key)
                  resolve('reject')
                }, 120_000)
                ccPermissionWaiters.set(key, { resolve, timer })
              })
            },
          )
          break
        }
        case 'cc_abort': {
          await claudeCode.abortClaudeCode(message.sessionId)
          break
        }
        case 'cc_permission_response': {
          const key = `${message.sessionId}:${message.toolUseId}`
          const waiter = ccPermissionWaiters.get(key)
          if (waiter) {
            clearTimeout(waiter.timer)
            ccPermissionWaiters.delete(key)
            waiter.resolve(message.response)
          }
          break
        }
        case 'cc_list_skills': {
          const skills = await claudeCode.listSkills(message.cwd)
          reply({ type: 'cc_skills', data: skills })
          break
        }
        case 'cc_get_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'error', message: 'Invalid skill name' })
            break
          }

          let skillPath: string | null = null
          if (message.source === 'plugin') {
            const requestedPath = safeString(message.path)
            if (!requestedPath) {
              reply({ type: 'error', message: 'Missing skill path' })
              break
            }
            try {
              const pluginsModule = await import('./plugins')
              const plugins = await pluginsModule.discoverPlugins(message.cwd)
              const resolved = resolve(requestedPath)
              const allowed = plugins.some((p) => resolved.startsWith(resolve(p.path) + sep))
              if (!allowed) {
                reply({ type: 'error', message: 'Skill path not allowed' })
                break
              }
              skillPath = resolved
            } catch {
              reply({ type: 'error', message: 'Failed to resolve plugin skill' })
              break
            }
          } else {
            skillPath = skillFiles.getClaudeCodeSkillFilePath({
              name: message.name,
              source: message.source,
              cwd: message.cwd,
            })
          }

          try {
            const content = await skillFiles.readSkillFile(skillPath)
            reply({
              type: 'cc_skill',
              data: { name: message.name, path: skillPath, source: message.source, content },
            })
          } catch {
            reply({ type: 'error', message: 'Skill not found' })
          }
          break
        }
        case 'cc_save_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'cc_skill_saved', data: { ok: false } })
            break
          }
          const path = skillFiles.getClaudeCodeSkillFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await skillFiles.writeSkillFile(path, message.content)
            reply({ type: 'cc_skill_saved', data: { ok: true, path } })
          } catch {
            reply({ type: 'cc_skill_saved', data: { ok: false } })
          }
          break
        }
        case 'cc_delete_skill': {
          const skillFiles = await import('./skills')
          if (!skillFiles.validateSkillName(message.name)) {
            reply({ type: 'cc_skill_deleted', data: { ok: false } })
            break
          }
          const path = skillFiles.getClaudeCodeSkillFilePath({
            name: message.name,
            source: message.source,
            cwd: message.cwd,
          })
          try {
            await skillFiles.deleteSkillByPath(path)
            reply({ type: 'cc_skill_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'cc_skill_deleted', data: { ok: false } })
          }
          break
        }
        case 'cc_list_hooks': {
          const hooks = await claudeCode.listHooks(message.cwd)
          reply({ type: 'cc_hooks', data: hooks })
          break
        }
        case 'cc_hooks_file_read': {
          const src = message.source
          const cwd = message.cwd || process.cwd()
          const hooksPath =
            src === 'project'
              ? join(cwd, '.claude', 'hooks', 'hooks.json')
              : join(homedir(), '.claude', 'hooks', 'hooks.json')
          try {
            const content = await readFile(hooksPath, 'utf-8')
            reply({ type: 'cc_hooks_file', data: { ok: true, source: src, path: hooksPath, content } })
          } catch {
            reply({ type: 'cc_hooks_file', data: { ok: true, source: src, path: hooksPath, content: '{"hooks":{}}' } })
          }
          break
        }
        case 'cc_hooks_file_write': {
          const src = message.source
          const cwd = message.cwd || process.cwd()
          const hooksPath =
            src === 'project'
              ? join(cwd, '.claude', 'hooks', 'hooks.json')
              : join(homedir(), '.claude', 'hooks', 'hooks.json')
          try {
            await mkdir(resolve(hooksPath, '..'), { recursive: true })
            await writeFile(hooksPath, message.content, 'utf-8')
            reply({ type: 'cc_hooks_file_written', data: { ok: true, source: src, path: hooksPath } })
          } catch {
            reply({ type: 'cc_hooks_file_written', data: { ok: false, source: src, path: hooksPath } })
          }
          break
        }
        case 'cc_mcp_file_read': {
          const cwd = message.cwd || process.cwd()
          const mcpPath = join(cwd, '.mcp.json')
          try {
            const content = await readFile(mcpPath, 'utf-8')
            reply({ type: 'cc_mcp_file', data: { ok: true, path: mcpPath, content } })
          } catch {
            reply({ type: 'cc_mcp_file', data: { ok: true, path: mcpPath, content: '{"mcpServers":{}}' } })
          }
          break
        }
        case 'cc_mcp_file_write': {
          const cwd = message.cwd || process.cwd()
          const mcpPath = join(cwd, '.mcp.json')
          try {
            await writeFile(mcpPath, message.content, 'utf-8')
            reply({ type: 'cc_mcp_file_written', data: { ok: true, path: mcpPath } })
          } catch {
            reply({ type: 'cc_mcp_file_written', data: { ok: false, path: mcpPath } })
          }
          break
        }
        case 'cc_list_commands': {
          const commands = await claudeCode.listCommands(message.cwd)
          reply({ type: 'cc_commands', data: commands })
          break
        }
        case 'cc_get_command': {
          const name = safeString(message.name)
          const source = message.source
          const cwd = message.cwd || process.cwd()

          if (!isSafeClaudeCommandName(name)) {
            reply({
              type: 'cc_command_file',
              data: { ok: false, name, source, path: '', content: '' },
            })
            break
          }

          let cmdPath = ''
          if (source === 'plugin') {
            const requestedPath = safeString(message.path)
            if (!requestedPath) {
              reply({
                type: 'cc_command_file',
                data: { ok: false, name, source, path: '', content: '' },
              })
              break
            }
            try {
              const pluginsModule = await import('./plugins')
              const plugins = await pluginsModule.discoverPlugins(message.cwd)
              const resolved = resolve(requestedPath)
              const allowed = plugins.some((p) => resolved.startsWith(resolve(p.path) + sep))
              if (!allowed) {
                reply({
                  type: 'cc_command_file',
                  data: { ok: false, name, source, path: '', content: '' },
                })
                break
              }
              cmdPath = resolved
            } catch {
              reply({
                type: 'cc_command_file',
                data: { ok: false, name, source, path: '', content: '' },
              })
              break
            }
          } else {
            cmdPath =
              source === 'project'
                ? join(cwd, '.claude', 'commands', `${name}.md`)
                : join(homedir(), '.claude', 'commands', `${name}.md`)
          }

          try {
            const content = await readFile(cmdPath, 'utf-8')
            reply({
              type: 'cc_command_file',
              data: { ok: true, name, source, path: cmdPath, content },
            })
          } catch {
            const defaultContent = [
              '---',
              `description: ${name}`,
              '---',
              '',
            ].join('\n')
            reply({
              type: 'cc_command_file',
              data: { ok: false, name, source, path: cmdPath, content: defaultContent },
            })
          }
          break
        }
        case 'cc_save_command': {
          const name = safeString(message.name)
          const source = message.source
          const cwd = message.cwd || process.cwd()

          if (source !== 'project' && source !== 'user') {
            reply({ type: 'cc_command_saved', data: { ok: false, name, source } })
            break
          }
          if (!isSafeClaudeCommandName(name)) {
            reply({ type: 'cc_command_saved', data: { ok: false, name, source } })
            break
          }

          const cmdPath =
            source === 'project'
              ? join(cwd, '.claude', 'commands', `${name}.md`)
              : join(homedir(), '.claude', 'commands', `${name}.md`)

          try {
            await mkdir(resolve(cmdPath, '..'), { recursive: true })
            await writeFile(cmdPath, message.content, 'utf-8')
            reply({ type: 'cc_command_saved', data: { ok: true, name, source, path: cmdPath } })
          } catch {
            reply({ type: 'cc_command_saved', data: { ok: false, name, source, path: cmdPath } })
          }
          break
        }
        case 'cc_delete_command': {
          const name = safeString(message.name)
          const source = message.source
          const cwd = message.cwd || process.cwd()

          if (source !== 'project' && source !== 'user') {
            reply({ type: 'cc_command_deleted', data: { ok: false, name, source } })
            break
          }
          if (!isSafeClaudeCommandName(name)) {
            reply({ type: 'cc_command_deleted', data: { ok: false, name, source } })
            break
          }

          const cmdPath =
            source === 'project'
              ? join(cwd, '.claude', 'commands', `${name}.md`)
              : join(homedir(), '.claude', 'commands', `${name}.md`)

          try {
            await rm(cmdPath, { force: true })
            reply({ type: 'cc_command_deleted', data: { ok: true, name, source } })
          } catch {
            reply({ type: 'cc_command_deleted', data: { ok: false, name, source } })
          }
          break
        }
        case 'cc_get_active_sessions': {
          const sessions = claudeCode.listActiveSessions()
          reply({ type: 'cc_active_sessions', data: sessions })
          break
        }
        case 'cc_get_config': {
          const config = await claudeCode.getConfig(message.cwd)
          reply({ type: 'cc_config', data: config })
          break
        }
        case 'cc_set_config': {
          const config = await claudeCode.setConfig(message.config, message.cwd)
          reply({ type: 'cc_config_updated', data: config })
          break
        }
        // Claude Code File Checkpointing (Undo/Revert)
        case 'cc_rewind_checkpoint': {
          const success = await claudeCode.rewindToCheckpoint(
            message.sessionId,
            message.checkpointUuid,
            message.cwd,
          )
          reply({ type: 'cc_checkpoint_rewound', success, sessionId: message.sessionId, checkpointUuid: message.checkpointUuid })
          break
        }
        // Claude Code Custom Tools
        case 'cc_list_custom_tools': {
          const customTools = await import('./custom-tools')
          const tools = await customTools.getCustomTools()
          reply({ type: 'cc_custom_tools', data: tools })
          break
        }
        case 'cc_get_custom_tool': {
          const customTools = await import('./custom-tools')
          const tool = await customTools.getCustomTool(message.id)
          reply({ type: 'cc_custom_tool', data: tool || null })
          break
        }
        case 'cc_save_custom_tool': {
          const customTools = await import('./custom-tools')
          // Validate the tool definition
          const validation = customTools.validateCustomTool(message.tool)
          if (!validation.valid) {
            reply({ type: 'error', message: `Invalid tool: ${validation.errors.join(', ')}` })
            break
          }
          // Generate ID if not present
          const toolToSave = {
            ...message.tool,
            id: message.tool.id || customTools.generateToolId(),
          }
          const savedTool = await customTools.saveCustomTool(toolToSave)
          reply({ type: 'cc_custom_tool_saved', data: savedTool })
          break
        }
        case 'cc_delete_custom_tool': {
          const customTools = await import('./custom-tools')
          const deleted = await customTools.deleteCustomTool(message.id)
          reply({ type: 'cc_custom_tool_deleted', data: deleted, id: message.id })
          break
        }
        case 'cc_test_custom_tool': {
          const customTools = await import('./custom-tools')
          const result = await customTools.testCustomTool(message.tool, message.testArgs)
          reply({ type: 'cc_custom_tool_test_result', data: result })
          break
        }
        // Claude Code Plugins
        case 'cc_list_plugins': {
          const plugins = await import('./plugins')
          const pluginList = await plugins.discoverPlugins(message.cwd)
          reply({ type: 'cc_plugins', data: pluginList })
          break
        }
        case 'cc_get_plugin': {
          const plugins = await import('./plugins')
          const plugin = await plugins.getPlugin(message.name)
          reply({ type: 'cc_plugin', data: plugin || null })
          break
        }
        case 'cc_toggle_plugin': {
          const plugins = await import('./plugins')
          const success = await plugins.togglePlugin(message.name, message.enabled)
          reply({ type: 'cc_plugin_toggled', data: success, name: message.name, enabled: message.enabled })
          break
        }
        case 'cc_add_plugin_path': {
          const plugins = await import('./plugins')
          const success = await plugins.addPluginPath(message.path)
          reply({ type: 'cc_plugin_path_added', data: success, path: message.path })
          break
        }
        case 'cc_remove_plugin_path': {
          const plugins = await import('./plugins')
          const success = await plugins.removePluginPath(message.path)
          reply({ type: 'cc_plugin_path_removed', data: success, path: message.path })
          break
        }
        case 'cc_get_plugin_config': {
          const plugins = await import('./plugins')
          const config = await plugins.getPluginConfig()
          reply({ type: 'cc_plugin_config', data: config })
          break
        }
        case 'cc_reload_plugins': {
          const plugins = await import('./plugins')
          const pluginList = await plugins.reloadPlugins(message.cwd)
          reply({ type: 'cc_plugins_reloaded', data: pluginList })
          break
        }
        // Artifact Index (SQLite)
        // TODO(artifacts): Re-enable when feature is ready (set ARTIFACTS_ENABLED = true)
        case 'artifacts_search': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_results', data: { artifacts: [], total: 0 } })
            break
          }
          const result = artifactIndex!.search({
            text: message.text,
            filters: message.filters,
            limit: message.limit,
            offset: message.offset,
          })
          reply({ type: 'artifacts_results', data: result })
          break
        }
        case 'artifacts_get': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifact', data: null })
            break
          }
          const artifact = artifactIndex!.get(message.id)
          reply({ type: 'artifact', data: artifact })
          break
        }
        case 'artifacts_update': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifact_updated', data: false, id: message.id })
            break
          }
          const ok = artifactIndex!.updateUserFields(message.id, {
            ...(message.userTags != null ? { userTags: message.userTags } : {}),
            ...(typeof message.starred === 'boolean' ? { starred: message.starred } : {}),
            ...(message.notes !== undefined ? { notes: message.notes } : {}),
          })
          reply({ type: 'artifact_updated', data: ok, id: message.id })
          break
        }
        case 'artifacts_get_config': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_config', data: { indexingEnabled: false, maxContentChars: 0, enrichment: { provider: 'off', followSelectedAgent: false, enabled: false, batchSize: 0, maxCharsPerArtifact: 0, hiddenCwd: '' } } })
            break
          }
          const cfg = await getArtifactsConfig!()
          reply({ type: 'artifacts_config', data: cfg })
          break
        }
        case 'artifacts_set_config': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_config', data: { indexingEnabled: false, maxContentChars: 0, enrichment: { provider: 'off', followSelectedAgent: false, enabled: false, batchSize: 0, maxCharsPerArtifact: 0, hiddenCwd: '' } } })
            break
          }
          const next = await setArtifactsConfig!(message.config ?? {})
          artifactIndex!.applyConfig(next)
          reply({ type: 'artifacts_config', data: next })
          // Kick enrichment if newly enabled.
          if (next.enrichment.enabled && next.enrichment.provider !== 'off') {
            void import('./artifacts/enrichment')
              .then((m) => m.triggerArtifactsEnrichment())
              .catch(() => {})
          }
          break
        }
        case 'artifacts_clear': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_cleared', data: true })
            break
          }
          artifactIndex!.clearAll()
          reply({ type: 'artifacts_cleared', data: true })
          break
        }
        case 'artifacts_stats': {
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_stats', data: { dbPath: '', dbSizeBytes: 0, totalArtifacts: 0, starredArtifacts: 0, backends: {}, queue: {}, updatedAt: Date.now() } })
            break
          }
          const base = artifactIndex!.stats()
          const dbPath = getArtifactsDbPath!()
          const dbSizeBytes = await getArtifactsDbSizeBytes!(dbPath)
          reply({
            type: 'artifacts_stats',
            data: {
              dbPath,
              dbSizeBytes,
              totalArtifacts: base.total,
              starredArtifacts: base.starred,
              backends: base.backends,
              queue: base.queue,
              updatedAt: Date.now(),
            },
          })
          break
        }
        case 'artifacts_enrich_now': {
          // Implemented in artifacts/enrichment - no-op until enabled.
          // TODO(artifacts): Re-enable when feature is ready
          if (!ARTIFACTS_ENABLED) {
            reply({ type: 'artifacts_enrich_started', data: false })
            break
          }
          const started = await (await import('./artifacts/enrichment')).triggerArtifactsEnrichment()
          reply({ type: 'artifacts_enrich_started', data: started })
          break
        }
        // Subscription Usage Tracking
        case 'get_subscription_usage': {
          const subscriptionTracker = await import('./subscription-tracker')
          const usage = await subscriptionTracker.getSubscriptionUsage()
          reply({ type: 'subscription_usage', data: usage })
          break
        }
        case 'get_provider_usage': {
          const subscriptionTracker = await import('./subscription-tracker')
          const usage = await subscriptionTracker.getProviderUsage(message.providerId)
          reply({ type: 'provider_usage', data: usage })
          break
        }
        default: {
          reply({ type: 'error', message: 'Unknown message type' })
        }
      }
    }

  const handleMessage = async (ws: ServerWebSocket<unknown>, raw: string | Uint8Array) => {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)

    let message: ClientMessage & { requestId?: string }
    try {
      message = JSON.parse(text) as ClientMessage & { requestId?: string }
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON payload' })
      return
    }

    const requestId = message.requestId
    const reply = (response: ServerMessage) => {
      send(ws, requestId ? { ...response, requestId } : response)
    }

    try {
      if (message.type === 'batch') {
        const batchedMessages = message.messages as Array<ClientMessage & { requestId?: string }>
        if (!Array.isArray(batchedMessages)) {
          reply({ type: 'error', message: 'Invalid batch: messages must be an array' })
          return
        }
        
        for (const batchedMsg of batchedMessages) {
          const batchReply = (response: ServerMessage) => {
            send(ws, batchedMsg.requestId ? { ...response, requestId: batchedMsg.requestId } : response)
          }
          
          try {
            await processSingleMessage(ws, batchedMsg, batchReply)
          } catch (batchError) {
            batchReply({ type: 'error', message: toErrorMessage(batchError) })
          }
        }
      } else {
        await processSingleMessage(ws, message, reply)
      }
    } catch (error) {
      reply({ type: 'error', message: toErrorMessage(error) })
    }
  }

  return {
    broadcast,
    enqueueSdkEvent,
    stop: (force = true) => {
      clearInterval(heartbeatTimer)
      for (const t of ccExternalTails.values()) {
        try {
          t.stop()
        } catch {
          // ignore
        }
      }
      ccExternalTails.clear()
      for (const t of cxExternalTails.values()) {
        try {
          t.stop()
        } catch {
          // ignore
        }
      }
      cxExternalTails.clear()
      for (const w of ccFsWatchers.values()) {
        if (w.debounce) clearTimeout(w.debounce)
        try {
          w.watcher.close()
        } catch {
          // ignore
        }
      }
      ccFsWatchers.clear()
      server.stop(force)
    },
    connections: () => sockets.size,
    port: () => actualPort,
    authToken: () => authToken,
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
