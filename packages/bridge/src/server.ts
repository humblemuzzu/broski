import type { ServerWebSocket } from 'bun'
import { lstat, mkdir, open, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants, watch as fsWatch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { OpenCodeConnector } from './connectors/opencode'
import type { AgentStatusInfo, AgentType, ClaudeCodeStreamMessage, ClientMessage, CodexStreamMessage, CodexThread, CodexTranscriptMessage, DeviceInfo, FileAttachment, PermissionResponse, ServerMessage } from './types'
import * as claudeCode from './connectors/claude-code'
import * as codexFs from './connectors/codex-fs'
import * as fileSearch from './file-search'
import { CodexAppServerClient, checkCodexAvailable } from './connectors/codex'
import { headTailTruncate } from './utils'
import { ensureTlsMaterial, isTlsEnabledByEnv, type TlsMaterial } from './tls'
import { getDefaultAllowedPaths, IS_WINDOWS } from './platform'

const TOKEN_FILE_LEGACY = resolve(homedir(), '.broski', 'token')
const TOKEN_FILE = resolve(homedir(), '.broski', 'token.json')
const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === '1' // Real-Time Sync debugging
const DEBUG_CX_GLOBAL = process.env.BROSKI_DEBUG_CX_GLOBAL === '1' // Forward noisy Codex global notifications
const BRIDGE_PROTOCOL_VERSION = '1.0.0'

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

function hasPrototypePoisonKeys(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object') return false
  if (depth > 50) return true
  if (Array.isArray(value)) {
    for (const v of value) {
      if (hasPrototypePoisonKeys(v, depth + 1)) return true
    }
    return false
  }
  const obj = value as Record<string, unknown>
  // Disallow keys commonly used for prototype pollution.
  if (Object.prototype.hasOwnProperty.call(obj, '__proto__')) return true
  if (Object.prototype.hasOwnProperty.call(obj, 'prototype')) return true
  if (Object.prototype.hasOwnProperty.call(obj, 'constructor')) return true
  for (const k of Object.keys(obj)) {
    if (hasPrototypePoisonKeys(obj[k], depth + 1)) return true
  }
  return false
}

function isSafeClaudeCommandName(name: string): boolean {
  const trimmed = (name || '').trim()
  if (trimmed.length < 1 || trimmed.length > 128) return false
  if (trimmed.includes('/') || trimmed.includes('\\')) return false
  return trimmed === basename(trimmed)
}

function resolveClaudeCommandFilePath(params: {
  cwd: string
  source: 'project' | 'user'
  name: string
}): string | null {
  const baseDir =
    params.source === 'project'
      ? join(params.cwd, '.claude', 'commands')
      : join(homedir(), '.claude', 'commands')

  const parts = params.name.split(':')
  if (parts.some((p) => p.length === 0)) return null

  const file = parts.length > 0 ? parts[parts.length - 1] : undefined
  if (!file) return null

  const dirParts = parts.slice(0, -1)
  const filePath = join(baseDir, ...dirParts, `${file}.md`)

  const resolvedBase = resolve(baseDir)
  const resolvedFile = resolve(filePath)
  if (resolvedFile !== resolvedBase && !resolvedFile.startsWith(resolvedBase + sep)) return null
  return resolvedFile
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
           name: `${safeString(item?.server)}.${safeString(item?.tool)}`.replace(/^\./, ''),
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

type AuthTokenState = {
  version: 1
  token: string
  createdAt: number
  expiresAt: number
  lastUsedAt?: number
}

function getTokenTtlMs(): number {
  const days = Number(process.env.BROSKI_TOKEN_TTL_DAYS ?? '7')
  const ttlMs = Math.floor((Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000)
  // Minimum: 1 hour, Maximum: 90 days (defense-in-depth against misconfig)
  return Math.min(Math.max(ttlMs, 60 * 60 * 1000), 90 * 24 * 60 * 60 * 1000)
}

function isLikelyValidToken(token: string): boolean {
  // Base64url token generated by generateAuthToken(). Keep this strict to avoid weird inputs.
  if (!token) return false
  if (token.length < 16 || token.length > 128) return false
  return /^[A-Za-z0-9_-]+$/.test(token)
}

async function persistAuthState(state: AuthTokenState): Promise<void> {
  await mkdir(dirname(TOKEN_FILE), { recursive: true })
  await writeFile(TOKEN_FILE, JSON.stringify(state), { mode: 0o600 })
}

async function createNewAuthState(now = Date.now()): Promise<AuthTokenState> {
  const token = generateAuthToken()
  const ttlMs = getTokenTtlMs()
  const state: AuthTokenState = {
    version: 1,
    token,
    createdAt: now,
    expiresAt: now + ttlMs,
    lastUsedAt: now,
  }
  await persistAuthState(state)
  // Best-effort: remove legacy token file to avoid confusion.
  try {
    await rm(TOKEN_FILE_LEGACY, { force: true })
  } catch {
    // ignore
  }
  return state
}

export async function loadOrCreateAuthState(forceNew = false): Promise<AuthTokenState> {
  const now = Date.now()

  if (!forceNew) {
    // New format.
    try {
      const raw = await readFile(TOKEN_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AuthTokenState>
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : ''
      const createdAt = Number(parsed.createdAt ?? 0) || now
      const expiresAt = Number(parsed.expiresAt ?? 0) || (createdAt + getTokenTtlMs())
      const lastUsedAt = Number(parsed.lastUsedAt ?? 0) || undefined

      if (parsed.version === 1 && isLikelyValidToken(token)) {
        if (now > expiresAt) {
          // Rotate on read if expired.
          return await createNewAuthState(now)
        }
        const state: AuthTokenState = {
          version: 1,
          token,
          createdAt,
          expiresAt,
          ...(lastUsedAt ? { lastUsedAt } : {}),
        }
        // Touch last-used (best-effort).
        void persistAuthState({ ...state, lastUsedAt: now }).catch(() => {})
        return state
      }
    } catch {
      // fall through
    }

    // Legacy format migration.
    try {
      const existing = await readFile(TOKEN_FILE_LEGACY, 'utf-8')
      const token = existing.trim()
      if (isLikelyValidToken(token)) {
        const ttlMs = getTokenTtlMs()
        const state: AuthTokenState = {
          version: 1,
          token,
          createdAt: now,
          expiresAt: now + ttlMs,
          lastUsedAt: now,
        }
        await persistAuthState(state)
        try {
          await rm(TOKEN_FILE_LEGACY, { force: true })
        } catch {
          // ignore
        }
        return state
      }
    } catch {
      // fall through
    }
  }

  return await createNewAuthState(now)
}

// Load or create persistent auth token (compat API for older callers)
export async function loadOrCreateAuthToken(forceNew = false): Promise<string> {
  const state = await loadOrCreateAuthState(forceNew)
  return state.token
}

// Security: Constant-time token comparison to prevent timing attacks
function tokenSha256(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

function validateAuthToken(provided: string, expectedToken: string): boolean {
  try {
    if (!isLikelyValidToken(provided)) return false
    const providedHash = tokenSha256(provided)
    const expectedHash = tokenSha256(expectedToken)
    return timingSafeEqual(providedHash, expectedHash)
  } catch {
    return false
  }
}

const SECURITY_ALLOWED_BASE_PATHS = (() => {
  const raw = (process.env.BROSKI_ALLOWED_BASE_PATHS ?? '').trim()
  const defaults = getDefaultAllowedPaths()
  const bases = raw
    ? raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : defaults
  return bases.map((p) => resolve(p))
})()

function isSecureBasePath(realPath: string): boolean {
  return SECURITY_ALLOWED_BASE_PATHS.some((base) => realPath === base || realPath.startsWith(base + sep))
}

async function getSecurePath(requestedPath: string): Promise<string | null> {
  try {
    if (!requestedPath || typeof requestedPath !== 'string') return null
    if (requestedPath.length > 4096) return null
    if (requestedPath.includes('\0')) return null
    // Reject ASCII control chars (helps avoid odd filesystem edge cases).
    if (/[\u0000-\u001F]/.test(requestedPath)) return null

    const expandedPath = requestedPath.startsWith('~')
      ? requestedPath.replace(/^~/, homedir())
      : requestedPath

    const abs = resolve(expandedPath)
    // Check the logical path (pre-symlink resolution) is within allowed bases.
    if (!isSecureBasePath(abs)) return null

    const rp = await realpath(abs).catch(() => null)
    if (!rp) return null

    // Check the real path (post-symlink resolution) is still within allowed bases.
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
    // Mitigate symlink-based TOCTOU by refusing to follow symlinks at open-time.
    // O_NOFOLLOW not available on Windows — symlink defense disabled there (acceptable trade-off for dev tool)
    const noFollow = Number((fsConstants as any).O_NOFOLLOW ?? 0) || 0
    if (!noFollow) {
      // Best-effort symlink refusal on platforms without O_NOFOLLOW.
      const lst = await lstat(securePath).catch(() => null)
      if (lst?.isSymbolicLink()) {
        return { content: '', mime: 'text/plain' }
      }
    }
    const flags = fsConstants.O_RDONLY | noFollow
    let fh = await open(securePath, flags).catch(async (err) => {
      // Fallback for platforms that don't support O_NOFOLLOW.
      if ((err as any)?.code === 'EINVAL' || (err as any)?.code === 'ENOTSUP') {
        return await open(securePath, 'r')
      }
      throw err
    })

    try {
      const file = Bun.file(securePath)
      const mime = file.type || 'application/octet-stream'
      const st = await fh.stat()
      if (!st.isFile()) return { content: '', mime: 'text/plain' }

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

      const text = await fh.readFile({ encoding: 'utf-8' })
    const maxChars = 1_000_000
    if (text.length > maxChars) {
      return { content: `${text.slice(0, maxChars)}\n\n…(truncated)…`, mime }
    }
    return { content: text, mime }
    } finally {
      await fh.close().catch(() => {})
    }
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
    // O_NOFOLLOW not available on Windows — symlink defense disabled there (acceptable trade-off for dev tool)
    const noFollow = Number((fsConstants as any).O_NOFOLLOW ?? 0) || 0
    if (!noFollow) {
      const lst = await lstat(securePath).catch(() => null)
      if (lst?.isSymbolicLink()) {
        return { error: 'not_found' }
      }
    }
    const flags = fsConstants.O_RDONLY | noFollow
    const fh = await open(securePath, flags).catch(async (err) => {
      if ((err as any)?.code === 'EINVAL' || (err as any)?.code === 'ENOTSUP') {
        return await open(securePath, 'r')
      }
      throw err
    })

    try {
      const st = await fh.stat()
      if (!st.isFile()) return { error: 'not_found' }
      const size = st.size
      const maxBytes = maxSizeMb * 1024 * 1024
      if (size > maxBytes) {
        return { error: 'too_large', size }
      }

      const buf = await fh.readFile()
      const base64 = Buffer.from(buf as any).toString('base64')
      const mime = Bun.file(securePath).type || 'application/octet-stream'
      return { base64, mime, size }
    } finally {
      await fh.close().catch(() => {})
    }
  } catch (error) {
    console.error(`[readFileBinaryDirectly] Error reading ${securePath}:`, error)
    return { error: 'not_found' }
  }
}

export type BridgeServerOptions = {
  port: number
  opencode: OpenCodeConnector | null
  currentAgent?: AgentType
  version: string
  auth: AuthTokenState
  /**
   * When true, also starts a loopback-only plaintext WS/HTTP server used for
   * Tailscale Funnel (which terminates TLS at the edge and proxies to localhost).
   */
  enableLoopbackInsecureServer?: boolean
  restartOpenCode?: () => Promise<boolean>
  logger?: (message: string) => void
}

export type BridgeServer = {
  broadcast: (message: ServerMessage) => void
  enqueueSdkEvent: (event: unknown) => void
  stop: (force?: boolean) => void
  connections: () => number
  port: () => number
  funnelBackendPort: () => number | null
  authToken: () => string
  tls: () => { enabled: boolean; certSha256: string | null }
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
  protocolVersion?: string
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
  'session.compacted': 'normal',
  'session.created': 'normal',
  'session.deleted': 'normal',
  'session.updated': 'low',
  'file.watcher.updated': 'low',
  'lsp.updated': 'low',
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
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
  type CodexApprovalReply = {
    response?: PermissionResponse
    execpolicyAmendment?: any
    answers?: Record<string, { selected: string[]; other?: string }>
  }
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
  
  let codexClient: CodexAppServerClient | null = null
  const { opencode, version, logger } = options

  const requireOpenCode = (): OpenCodeConnector => {
    if (!opencode) {
      throw new Error(
        'OpenCode backend is not available on this machine. Install OpenCode (or start it and attach), or switch to Claude Code / Codex in the app.',
      )
    }
    return opencode
  }

  const BACKEND_STATUS_TTL_MS = 1500
  let backendsCache: { fetchedAt: number; data: Record<AgentType, AgentStatusInfo> } | null = null
  let backendsInFlight: Promise<Record<AgentType, AgentStatusInfo>> | null = null

  const getBackendsStatus = async (): Promise<Record<AgentType, AgentStatusInfo>> => {
    const now = Date.now()
    if (backendsCache && now - backendsCache.fetchedAt <= BACKEND_STATUS_TTL_MS) {
      return backendsCache.data
    }
    if (backendsInFlight) return backendsInFlight

    backendsInFlight = (async () => {
      const envKey = !!process.env.ANTHROPIC_API_KEY

      const [ocOk, ccOk, cxOk] = await Promise.all([
        (async () => {
          try {
            return opencode ? await opencode.isRunning() : false
          } catch {
            return false
          }
        })(),
        (async () => {
          try {
            return await claudeCode.checkClaudeCodeAvailable()
          } catch {
            return false
          }
        })(),
        (async () => {
          try {
            return await checkCodexAvailable()
          } catch {
            return false
          }
        })(),
      ])

      const data: Record<AgentType, AgentStatusInfo> = {
        opencode: { available: ocOk, version },
        'claude-code': {
          available: ccOk,
          authMethod: ccOk ? (envKey ? 'api-key' : 'claude-login') : undefined,
        },
        codex: { available: cxOk, authMethod: cxOk ? 'cli' : undefined },
      }

      backendsCache = { fetchedAt: Date.now(), data }
      return data
    })()

    try {
      return await backendsInFlight
    } finally {
      backendsInFlight = null
    }
  }
  
  let currentAgent: AgentType = options.currentAgent || 'opencode'
  const lastGitBranchByProject = new Map<string, string>()
  
  let authState: AuthTokenState = options.auth
  let authToken = authState.token
  let authExpiresAt = authState.expiresAt
  const allowTokenInUrl = process.env.BROSKI_ALLOW_TOKEN_IN_URL === '1'
  const tlsEnabled = isTlsEnabledByEnv()
  let tlsMaterial: TlsMaterial | null = null

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
          // Codex app-server protocol places threadId in different locations by notification type
          let threadId = safeString(params.threadId ?? params.thread_id ?? params.threadID)
          const turnId = safeString(params.turnId ?? params.turn_id ?? params.turnID)

          if (n.method === 'thread/started') {
            const thread = params.thread
            const id = safeString(thread?.id)
            const cwd = safeString(thread?.cwd)
            if (id && cwd) cxThreadCwds.set(id, resolve(cwd))
            if (id && !threadId) threadId = id
          }

          if (!threadId && params.turn?.threadId) {
            threadId = safeString(params.turn.threadId)
          }

          if (!threadId && params.item?.threadId) {
            threadId = safeString(params.item.threadId)
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

              // Handle context compaction events
              if (safeString(item?.type) === 'contextCompaction') {
                const compactionStatus = n.method === 'item/started' ? 'started' : 'completed'
                console.log(`[Codex] context compaction ${compactionStatus}: threadId=${threadId}`)
              }
            }
          }

          // Resolve owner EARLY so all downstream code can use it safely
          const owner = threadId ? cxThreadOwners.get(threadId) : null

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

          // Log turn lifecycle events for debugging
          if (n.method === 'turn/started') {
            console.log(`[Codex] turn/started: threadId=${threadId}, turnId=${turnId}`)
          }
          if (n.method === 'turn/completed') {
            const turnStatus = safeString(params.turn?.status).toLowerCase()
            const turnError = params.turn?.error
            console.log(`[Codex] turn/completed: threadId=${threadId}, turnId=${turnId}, status=${turnStatus}`)
            
            // Handle turn/completed with failed status (different from turn/failed notification)
            if (turnStatus === 'failed' && turnError && threadId) {
              const errorMessage = typeof turnError === 'string' 
                ? turnError 
                : turnError?.message ?? turnError?.additionalDetails ?? JSON.stringify(turnError)
              const errorCode = turnError?.codexErrorInfo ?? turnError?.code ?? 'turn_failed'
              
              console.error(`[Codex] turn/completed with failed status:`, JSON.stringify(turnError, null, 2))
              
              // Extract ModelCap info if present
              const codexErrorInfoTC = turnError?.codexErrorInfo ?? turnError?.details?.codexErrorInfo
              let modelCapModelTC: string | undefined
              let modelCapRetrySecondsTC: number | undefined
              if (codexErrorInfoTC && typeof codexErrorInfoTC === 'object') {
                if (codexErrorInfoTC.type === 'ModelCap' || codexErrorInfoTC.ModelCap) {
                  const cap = codexErrorInfoTC.ModelCap ?? codexErrorInfoTC
                  modelCapModelTC = cap.model ?? cap.modelName
                  modelCapRetrySecondsTC = cap.reset_after_seconds ?? cap.resetAfterSeconds
                }
              }
              
              emitCxStream(threadId, { 
                type: 'error', 
                message: errorMessage,
                code: typeof errorCode === 'string' ? errorCode : JSON.stringify(errorCode),
                details: turnError,
                modelCapModel: modelCapModelTC,
                modelCapRetrySeconds: modelCapRetrySecondsTC,
              }, owner)
            }
          }
          // Handle turn failures and errors - EMIT TO CLIENT, not just log!
          if (n.method === 'turn/failed' || n.method === 'error') {
            const turn = params.turn
            const error = turn?.error ?? params.error ?? params
            console.error(`[Codex] ${n.method}: threadId=${threadId}`, JSON.stringify(error, null, 2))
            if (threadId) {
              cxActiveTurns.delete(threadId)
              
              // CRITICAL: Emit error to client so UI knows the turn failed
              const errorMessage = typeof error === 'string' 
                ? error 
                : error?.message ?? error?.additionalDetails ?? JSON.stringify(error)
              const errorCode = error?.codexErrorInfo ?? error?.code ?? n.method
              
              // Extract ModelCap info if present
              const codexErrorInfoTF = error?.codexErrorInfo ?? error?.details?.codexErrorInfo
              let modelCapModelTF: string | undefined
              let modelCapRetrySecondsTF: number | undefined
              if (codexErrorInfoTF && typeof codexErrorInfoTF === 'object') {
                if (codexErrorInfoTF.type === 'ModelCap' || codexErrorInfoTF.ModelCap) {
                  const cap = codexErrorInfoTF.ModelCap ?? codexErrorInfoTF
                  modelCapModelTF = cap.model ?? cap.modelName
                  modelCapRetrySecondsTF = cap.reset_after_seconds ?? cap.resetAfterSeconds
                }
              }
              
              emitCxStream(threadId, { 
                type: 'error', 
                message: errorMessage,
                code: typeof errorCode === 'string' ? errorCode : JSON.stringify(errorCode),
                details: error,
                modelCapModel: modelCapModelTF,
                modelCapRetrySeconds: modelCapRetrySecondsTF,
              }, owner)
              
              // CRITICAL: Send session.idle to reset UI state
              if (owner) {
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
            }
          }
          // Handle thread/compacted (deprecated notification)
          if (n.method === 'thread/compacted') {
            console.log(`[Codex] thread/compacted (deprecated): threadId=${threadId}`)
            if (threadId) {
              emitCxStream(threadId, { type: 'notification', method: 'thread/compacted', params }, owner)
            }
          }

          // Log response items for debugging
          if (n.method === 'item/started' || n.method === 'item/completed') {
            const item = params.item
            const itemType = safeString(item?.type)
            const itemId = safeString(item?.id)
            console.log(`[Codex] ${n.method}: threadId=${threadId}, itemType=${itemType}, itemId=${itemId}`)
          }

          // Multi-Agent Collaboration Events (Codex SDK v0.87.0+)
          // EXPERIMENTAL: `collab/*` notifications are not part of the stable, documented
          // Codex protocol surface. We forward them for richer UI rendering, but they may
          // change or disappear in future SDK/app-server versions.
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
            const collabOwner = senderThread ? cxThreadOwners.get(senderThread) : null
            emitCxStream(senderThread || threadId, { type: `collab_${collabMethod}` as any, data: collabData }, collabOwner)
            return
          }

          if (!threadId) {
            // Some notifications are global (no threadId): auth, rate limits, MCP oauth completion, etc.
            // NOTE: Codex app-server can emit extremely high-volume `codex/event/*` telemetry
            // (often duplicating the same information we already forward via `cx_stream`).
            // Forwarding this to every client can overwhelm mobile devices during streaming,
            // making “High” effort appear to hang. By default we drop `codex/event/*` and
            // only forward them when explicitly enabled for debugging.
            if (DEBUG_CX_GLOBAL || !n.method.startsWith('codex/event/')) {
              for (const ws of sockets) {
                send(ws, { type: 'cx_global', data: { method: n.method, params } })
              }
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

          return { decision }
        },
        // Handle app-server crash - notify all affected clients
        onExit: (code, signal) => {
          console.error(`[Codex] App-server crashed! code=${code}, signal=${signal}`)
          
          // Notify all thread owners that the server crashed
          for (const [threadId, owner] of cxThreadOwners.entries()) {
            send(owner, {
              type: 'cx_stream',
              threadId,
              data: { 
                type: 'error', 
                message: `Codex app-server crashed (exit code: ${code})`,
                code: 'app_server_crashed',
              },
            })
            
            // Reset UI state
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
          
          // Clean up all state
          cxThreadOwners.clear()
          cxActiveTurns.clear()
          cxApprovalWaiters.forEach(w => {
            clearTimeout(w.timer)
            w.resolve({ response: 'reject' })
          })
          cxApprovalWaiters.clear()
          
          // Reset client so it can be re-created on next request
          codexClient = null
        },
        onError: (error) => {
          console.error(`[Codex] App-server error:`, error.message)
          
          // Broadcast error to all connected clients
          for (const ws of sockets) {
            send(ws, { type: 'cx_global', data: { method: 'error', params: { message: error.message } } })
          }
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
    const oc = requireOpenCode()
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
        const statusMap = await oc.getSessionStatus(projectPath).catch(() => ({}))
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
        const messages = await oc.getSessionMessages(sessionId, projectPath).catch(() => null)
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

    const extractUsage = (parsed: any): { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } => {
      const usage = parsed?.message?.usage
      if (!usage || typeof usage !== 'object') return {}
      const inputTokens = Number((usage as any).input_tokens ?? NaN)
      const outputTokens = Number((usage as any).output_tokens ?? NaN)
      const cacheReadTokens = Number((usage as any).cache_read_input_tokens ?? NaN)
      const cacheWriteTokens = Number((usage as any).cache_creation_input_tokens ?? NaN)
      const reasoningTokens = Number((usage as any).reasoning_tokens ?? (usage as any).reasoning_output_tokens ?? NaN)
      return {
        ...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
        ...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
        ...(Number.isFinite(cacheReadTokens) ? { cacheReadTokens } : {}),
        ...(Number.isFinite(cacheWriteTokens) ? { cacheWriteTokens } : {}),
        ...(Number.isFinite(reasoningTokens) ? { reasoningTokens } : {}),
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
                const itemId = `cx-ext-msg-${ts.replace(/[^a-zA-Z0-9]/g, '_')}`
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
      const shouldRun = watcherCount > 0 && !!opencode && !!projectPath
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
    streamMsg: ClaudeCodeStreamMessage,
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
    const resolvedOwner = owner ?? cxThreadOwners.get(threadId) ?? null
    
    if (DEBUG_RTS) {
      const msgType = (streamMsg as any)?.type ?? (streamMsg as any)?.method ?? 'unknown'
      console.log(`[RTS] emitCxStream: thread=${threadId}, msgType=${msgType}, owner=${!!resolvedOwner}, watchers=${watchers?.size ?? 0}`)
    }
    
    if (resolvedOwner) {
      send(resolvedOwner, payload)
    }
    broadcastToSessionWatchers('codex', threadId, payload, resolvedOwner)
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

    const ctx = contexts.get(ws) ?? {
      lastPongAt: Date.now(),
      lastRttMs: 0,
      connectionType: 'unknown' as const,
      connectedAt: Date.now(),
    }
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
      } catch (err) {
        console.warn('[server] Failed to process SDK event microtask:', err)
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
      if (!opencode) {
        return jsonResponse({ error: 'OpenCode not available' }, 503)
      }
      try {
        const data = await opencode.listProjects()
        return jsonResponse(data)
      } catch {
        return jsonResponse({ error: 'Request failed' }, 500)
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
      } catch {
        return jsonResponse({ error: 'Request failed' }, 500)
      }
    }

    return new Response('Not found', { status: 404 })
  }

  const MAX_WS_MESSAGE_BYTES = Math.max(
    1024 * 1024, // 1MB minimum
    Math.min(Number(process.env.BROSKI_MAX_WS_MESSAGE_MB ?? '50') * 1024 * 1024, 200 * 1024 * 1024), // cap at 200MB
  )

  const RATE = {
    perSecond: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_PER_SEC ?? '250'), 5000)),
    burst: Math.max(10, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BURST ?? '500'), 20000)),
    blockMs: Math.max(1000, Math.min(Number(process.env.BROSKI_RATE_LIMIT_BLOCK_MS ?? '10000'), 60_000)),
  }

  const rateLimiters = new Map<ServerWebSocket<unknown>, { tokens: number; lastRefill: number; blockedUntil: number }>()
  const MAX_CLIENTS = Math.max(1, Math.min(Number(process.env.BROSKI_MAX_CLIENTS ?? '8'), 100))
  const allowedDeviceIdsRaw = (process.env.BROSKI_ALLOWED_DEVICE_IDS ?? '').trim()
  const ALLOWED_DEVICE_IDS = new Set(
    allowedDeviceIdsRaw
      ? allowedDeviceIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  )

  const isAllowedOrigin = (origin: string | null): boolean => {
    // Browsers set Origin. Native clients usually don't.
    if (!origin) return true
    if (origin.startsWith('file://')) return true
    // Allow local dev origins (if someone ever builds a web UI).
    if (origin === 'http://localhost' || origin === 'http://127.0.0.1') return true
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return true
    if (origin.startsWith('https://localhost:') || origin.startsWith('https://127.0.0.1:')) return true
    return false
  }

  const extractProtocolToken = (protocolHeader: string | null): string | null => {
    if (!protocolHeader) return null
    // Header is comma-separated. We accept tokens in the form: "broski-auth.<token>".
    const parts = protocolHeader.split(',').map((p) => p.trim()).filter(Boolean)
    for (const p of parts) {
      if (p.startsWith('broski-auth.')) {
        const tok = p.slice('broski-auth.'.length)
        return tok || null
      }
    }
    return null
  }

  const extractTokenFromRequest = (url: URL, request: Request): string | null => {
    const authHeader = request.headers.get('authorization')
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const tokenFromProtocol = extractProtocolToken(request.headers.get('sec-websocket-protocol'))
    const tokenFromQuery = allowTokenInUrl ? url.searchParams.get('token') : null
    return tokenFromHeader || tokenFromProtocol || tokenFromQuery
  }

  const publicJson = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response => {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json',
        // Hardening headers (API-only, so we can be strict).
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        ...extraHeaders,
      },
    })
  }

  const rotateExpiredAuthToken = async (): Promise<void> => {
    const now = Date.now()
    if (now <= authExpiresAt) return
    // Rotate token on first contact after expiry.
    authState = await createNewAuthState(now)
    authToken = authState.token
    authExpiresAt = authState.expiresAt
    log('[Auth] Token expired; rotated. Run `broski qr` to re-pair (old QR codes invalid).')
    // Drop existing connections; they are no longer authorized.
    for (const ws of sockets) {
      try {
        ws.close(4003, 'Auth token rotated')
      } catch {
        // ignore
      }
    }
  }

  if (tlsEnabled) {
    tlsMaterial = await ensureTlsMaterial()
  } else {
    log('[Security] BROSKI_TLS=0 set. Running WITHOUT transport encryption for direct connections.')
  }

  const checkRateLimit = (ws: ServerWebSocket<unknown>): boolean => {
    const now = Date.now()
    const state = rateLimiters.get(ws) ?? { tokens: RATE.burst, lastRefill: now, blockedUntil: 0 }
    if (state.blockedUntil && now < state.blockedUntil) {
      rateLimiters.set(ws, state)
      return false
    }
    const elapsedSec = (now - state.lastRefill) / 1000
    state.tokens = Math.min(RATE.burst, state.tokens + elapsedSec * RATE.perSecond)
    state.lastRefill = now
    if (state.tokens < 1) {
      state.blockedUntil = now + RATE.blockMs
      rateLimiters.set(ws, state)
      return false
    }
    state.tokens -= 1
    rateLimiters.set(ws, state)
    return true
  }

  const websocketConfig = {
    open(ws: ServerWebSocket<unknown>) {
      sockets.add(ws)
      rateLimiters.set(ws, { tokens: RATE.burst, lastRefill: Date.now(), blockedUntil: 0 })
      contexts.set(ws, {
        lastPongAt: Date.now(),
        lastRttMs: 0,
        connectionType: 'unknown',
        connectedAt: Date.now(),
      })
      log(`Client connected (${sockets.size} total)`)
      void sendStatus(ws)
    },
    close(ws: ServerWebSocket<unknown>) {
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
          }
        }
        for (const k of releasedKeys) {
          syncExternalTailForKey(makeSessionKey(k.agent, k.id))
        }
        
        sockets.delete(ws)
        contexts.delete(ws)
        rateLimiters.delete(ws)
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
    message(ws: ServerWebSocket<unknown>, raw: string | Uint8Array) {
      const bytes = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength
      if (bytes > MAX_WS_MESSAGE_BYTES) {
        try {
          ws.close(1009, 'Message too large')
        } catch {
          // ignore
        }
        return
      }
      if (!checkRateLimit(ws)) {
        // Best-effort: notify, but don't amplify further under load.
        try {
          send(ws, { type: 'error', message: 'RATE_LIMITED' })
        } catch {
          // ignore
        }
        return
      }
      void handleMessage(ws, raw)
    },
  } satisfies Bun.WebSocketHandler<unknown>

  const makeFetch = (serverLabel: string) => {
    return async (request: Request, serverInstance: any): Promise<Response | void> => {
      const url = new URL(request.url)

      // Reject token-in-URL by default (tokens leak into logs, proxies, referrers).
      if (!allowTokenInUrl && url.searchParams.has('token')) {
        return publicJson({ error: 'Token in URL not allowed' }, 400)
      }

      await rotateExpiredAuthToken()

      const isWebSocketUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      if (isWebSocketUpgrade) {
        if (sockets.size >= MAX_CLIENTS) {
          log(`[Security] WS rejected: too many clients (${sockets.size} >= ${MAX_CLIENTS})`)
          return new Response('Too many clients', { status: 429 })
        }
        const origin = request.headers.get('origin')
        if (!isAllowedOrigin(origin)) {
          log(`[Security] WS rejected (origin): ${origin}`)
          return new Response('Forbidden', { status: 403 })
        }
      }

      const providedToken = extractTokenFromRequest(url, request)
      const isValidToken = !!(providedToken && validateAuthToken(providedToken, authToken) && Date.now() <= authExpiresAt)

      if (isWebSocketUpgrade) {
        if (!isValidToken) {
          log(`[Security] WS rejected (auth) via ${serverLabel}`)
          return new Response('Unauthorized', { status: 401 })
        }
        if (serverInstance.upgrade(request)) return
        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      if (!isValidToken) {
        return publicJson({ error: 'Unauthorized' }, 401)
      }

      try {
        return await handleHttp(request)
      } catch (error) {
        log(`[HTTP] Error: ${toErrorMessage(error)}`)
        return publicJson({ error: toPublicErrorMessage(error) }, 500)
      }
    }
  }

  const secureServer = Bun.serve({
    port: options.port,
    ...(tlsMaterial
      ? {
          tls: {
            key: Bun.file(tlsMaterial.keyPath),
            cert: Bun.file(tlsMaterial.certPath),
          },
        }
      : {}),
    fetch: makeFetch('secure'),
    websocket: websocketConfig,
  })
  const securePort = (secureServer as any).port ?? options.port

  let loopbackServer: ReturnType<typeof Bun.serve> | null = null
  let loopbackPort: number | null = null
  if (options.enableLoopbackInsecureServer) {
    loopbackServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: makeFetch('loopback'),
      websocket: websocketConfig,
    })
    loopbackPort = (loopbackServer as any).port ?? null
    if (loopbackPort) {
      log(`[Funnel] Loopback backend listening on 127.0.0.1:${loopbackPort}`)
    }
  }

  async function sendStatus(ws: ServerWebSocket<unknown>): Promise<void> {
    const ctx = contexts.get(ws)
    const activeAgent: AgentType = ctx?.viewAgent ?? currentAgent
    const backends = await getBackendsStatus()
    send(ws, {
      type: 'status',
      data: {
        opencodeRunning: backends.opencode.available,
        activeAgent,
        backends,
      },
    })
  }

  const processSingleMessage = async (
    ws: ServerWebSocket<unknown>,
    message: ClientMessage & { requestId?: string },
    reply: (response: ServerMessage) => void,
  ) => {
    switch (message.type) {
      case 'register_device': {
        if (!message.deviceId || typeof message.deviceId !== 'string' || message.deviceId.length > 128) {
          reply({ type: 'error', message: 'Invalid deviceId' })
          try {
            ws.close(4004, 'Invalid deviceId')
          } catch {
            // ignore
          }
          break
        }
        if (ALLOWED_DEVICE_IDS.size > 0 && !ALLOWED_DEVICE_IDS.has(message.deviceId)) {
          reply({ type: 'error', message: 'Device not allowed' })
          try {
            ws.close(4004, 'Device not allowed')
          } catch {
            // ignore
          }
          break
        }
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
          protocolVersion: safeString((message as any).protocolVersion) || undefined,
        })
        const deviceInfo = getDeviceInfo(ws)
        if (deviceInfo) {
          reply({ type: 'device_registered', data: deviceInfo, protocolVersion: BRIDGE_PROTOCOL_VERSION })
          broadcast({ type: 'device_connected', data: deviceInfo })
        }
        log(`Device registered: ${message.deviceName} (${message.platform})`)
        void sendStatus(ws)
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
           const existing = contexts.get(ws) ?? {
             lastPongAt: Date.now(),
             lastRttMs: 0,
             connectionType: 'unknown' as const,
             connectedAt: Date.now(),
           }
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
          const oc = requireOpenCode()
          const projects = await oc.listProjects()
          reply({ type: 'projects', data: projects })
          break
        }
        case 'restart_opencode': {
          const ok = await options.restartOpenCode?.()
          reply({ type: 'opencode_restarted', data: ok === true })
          break
        }
        case 'list_sessions': {
          const oc = requireOpenCode()
          const sessions = await oc.listSessions(message.projectPath)
          reply({ type: 'sessions', data: sessions, projectPath: message.projectPath })
          break
        }
        case 'list_providers': {
          const oc = requireOpenCode()
          const providers = await oc.listProviders()
          reply({ type: 'providers', data: providers })
          break
        }
        case 'get_config': {
          const oc = requireOpenCode()
          // Use instance directory as fallback when no project is specified
          const projectPath = message.projectPath ?? await oc.getInstanceDirectory()
          const config = await oc.getConfig(projectPath ?? undefined)
          reply({ type: 'config', data: config })
          break
        }
        case 'set_config': {
          const oc = requireOpenCode()
          // Use instance directory as fallback when no project is specified
          const projectPath = message.projectPath ?? await oc.getInstanceDirectory()
          const config = await oc.updateConfig(message.config, projectPath ?? undefined)
          reply({ type: 'config', data: config })
          break
        }
        case 'set_model': {
          const oc = requireOpenCode()
          await oc.updateModel(message.model, message.projectPath)
          const config = await oc.getConfig(message.projectPath)
          reply({ type: 'config', data: config })
          break
        }
        case 'create_session': {
          const oc = requireOpenCode()
          const session = await oc.createSession(
            message.projectPath,
            message.title,
            message.permission,
          )
          reply({ type: 'session_created', data: session })
          break
        }
        case 'get_session': {
          const oc = requireOpenCode()
          const session = await oc.getSession(message.sessionId, message.projectPath)
          reply({ type: 'session', data: session })
          break
        }
        case 'get_session_messages': {
          const oc = requireOpenCode()
          const messages = await oc.getSessionMessages(
            message.sessionId,
            message.projectPath,
            message.limit,
          )
          reply({ type: 'session_messages', data: messages, sessionId: message.sessionId })
          break
        }
        case 'chat': {
          const oc = requireOpenCode()
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
          await oc.sendPromptAsync(
            message.sessionId,
            message.content,
            message.projectPath,
            message.model,
            message.agent,
            message.fileAttachments,
            message.variant,
          )
          break
        }
        case 'abort': {
          const oc = requireOpenCode()
          await oc.abortSession(message.sessionId, message.projectPath)
          break
        }
        case 'diff': {
          const oc = requireOpenCode()
          const diff = await oc.getSessionDiff(
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
          const oc = requireOpenCode()
          // OpenCode only accepts: once | always | reject
          const raw = message.response
          const normalized: 'once' | 'always' | 'reject' =
            raw === 'once' || raw === 'always' || raw === 'reject' ? raw : 'reject'
          if (raw !== normalized) {
            console.warn('[permission_response] Invalid OpenCode permission response, forcing reject:', raw)
          }
          // Use the new permission.reply() API - permissionId is now requestId
          await oc.respondToPermission(
            message.permissionId,  // This is the requestID in the new API
            normalized,
            message.message,  // Optional rejection feedback message
            message.projectPath,
          )
          break
        }
        case 'list_pending_permissions': {
          const oc = requireOpenCode()
          const pending = await oc.listPendingPermissions(message.projectPath)
          reply({ type: 'pending_permissions', data: pending })
          break
        }
        case 'list_pending_questions': {
          const oc = requireOpenCode()
          const pending = await oc.listPendingQuestions(message.projectPath)
          reply({ type: 'pending_questions', data: pending })
          break
        }
        case 'get_lsp_status': {
          const oc = requireOpenCode()
          const lspStatus = await oc.getLspStatus(message.projectPath)
          reply({ type: 'lsp_status', data: lspStatus })
          break
        }
        case 'get_session_context': {
          const oc = requireOpenCode()
          const context = await oc.getSessionContext(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_context', data: context, sessionId: message.sessionId })
          break
        }
        // Feature 1: Todo/Plan Management
        case 'get_todos': {
          const oc = requireOpenCode()
          const todos = await oc.getTodos(message.sessionId, message.projectPath)
          reply({ type: 'todos', data: todos, sessionId: message.sessionId })
          break
        }
        // Feature 2: Slash Commands
        case 'list_commands': {
          const oc = requireOpenCode()
          const commands = await oc.listCommands(message.projectPath)
          reply({ type: 'commands', data: commands })
          break
        }
        case 'execute_command': {
          const oc = requireOpenCode()
          const result = await oc.executeCommand(
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
          const oc = requireOpenCode()
          const agents = await oc.listAgents(message.projectPath)
          reply({ type: 'agents', data: agents })
          break
        }
        // Feature 4: Session Delete
        case 'delete_session': {
          const oc = requireOpenCode()
          const deleted = await oc.deleteSession(message.sessionId, message.projectPath)
          reply({ type: 'session_deleted', data: deleted, sessionId: message.sessionId })
          break
        }
        // Feature 5: Session Update (Rename)
        case 'update_session': {
          const oc = requireOpenCode()
          const session = await oc.updateSession(
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
          const oc = requireOpenCode()
          const session = await oc.forkSession(
            message.sessionId,
            message.messageId,
            message.projectPath,
          )
          reply({ type: 'session_forked', data: session })
          break
        }
        // Feature 7: Message Revert (Undo)
        case 'revert_message': {
          const oc = requireOpenCode()
          const session = await oc.revertMessage(
            message.sessionId,
            message.messageId,
            message.partId,
            message.projectPath,
          )
          reply({ type: 'message_reverted', data: session, sessionId: message.sessionId })
          break
        }
        case 'unrevert_session': {
          const oc = requireOpenCode()
          const session = await oc.unrevertSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_unreverted', data: session, sessionId: message.sessionId })
          break
        }
        // Feature 8: Session Share
        case 'share_session': {
          const oc = requireOpenCode()
          const session = await oc.shareSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_shared', data: session, sessionId: message.sessionId })
          break
        }
        case 'unshare_session': {
          const oc = requireOpenCode()
          const session = await oc.unshareSession(
            message.sessionId,
            message.projectPath,
          )
          reply({ type: 'session_unshared', data: session, sessionId: message.sessionId })
          break
        }
        // Feature 9: Session Summarize (Compact)
        case 'summarize_session': {
          const oc = requireOpenCode()
          const success = await oc.summarizeSession(
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
          const oc = requireOpenCode()
          const vcs = await oc.getVcsInfo(message.projectPath)
          reply({ type: 'vcs', data: vcs })
          break
        }
        // Feature 11: File Content Read
        case 'read_file': {
          const content = message.projectPath
            ? await requireOpenCode().readFile(message.path, message.projectPath)
            : await readFileDirectly(message.path)
          reply({ type: 'file_content', data: content, path: message.path })
          break
        }
        case 'read_file_binary': {
          const maxSizeMb = message.maxSizeMb ?? 10
          const result = await readFileBinaryDirectly(message.path, maxSizeMb)
          if ('error' in result) {
            if (result.error === 'too_large') {
              reply({
                type: 'file_too_large',
                data: {
                  path: message.path,
                  size: result.size ?? 0,
                  maxSize: maxSizeMb * 1024 * 1024,
                },
              })
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
          const oc = requireOpenCode()
          const files = await oc.findFiles(message.query, message.projectPath)
          reply({ type: 'files_found', data: files })
          break
        }
        case 'find_text': {
          const oc = requireOpenCode()
          const results = await oc.findText(message.pattern, message.include, message.projectPath)
          reply({ type: 'text_found', data: results })
          break
        }
        case 'find_symbols': {
          const oc = requireOpenCode()
          const symbols = await oc.findSymbols(message.query, message.projectPath)
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
            const oc = requireOpenCode()
            const results = await oc.searchFilesAndDirs(message.query, message.projectPath)
            reply({ type: 'files_and_dirs_found', data: results })
          }
          break
        }
        // Feature 13: Session Status
        case 'get_session_status': {
          const oc = requireOpenCode()
          const status = await oc.getSessionStatus(message.projectPath)
          reply({ type: 'session_status', data: status })
          break
        }
        // Feature 14: PTY Terminal Sessions
        case 'list_pty': {
          try {
            const oc = requireOpenCode()
            log(`[PTY] Listing PTY sessions for projectPath: ${message.projectPath ?? '(none)'}`)
            const ptys = await oc.listPty(message.projectPath)
            log(`[PTY] Found ${ptys.length} PTY sessions`)
            reply({ type: 'pty_list', data: ptys })
          } catch (error) {
            log(`[PTY] list_pty error: ${error}`)
            reply({ type: 'error', message: 'PTY list failed' })
          }
          break
        }
        case 'create_pty': {
          try {
            const oc = requireOpenCode()
            log(`[PTY] Creating PTY session: command=${message.command}, title=${message.title}, cwd=${message.cwd}, projectPath=${message.projectPath}`)
            const pty = await oc.createPty(
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
            reply({ type: 'error', message: 'PTY create failed' })
          }
          break
        }
        case 'get_pty': {
          const oc = requireOpenCode()
          const pty = await oc.getPty(message.ptyId, message.projectPath)
          if (pty) {
            reply({ type: 'pty', data: pty })
          } else {
            reply({ type: 'error', message: 'PTY session not found' })
          }
          break
        }
        case 'update_pty': {
          const oc = requireOpenCode()
          const pty = await oc.updatePty(
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
          const oc = requireOpenCode()
          const deleted = await oc.deletePty(message.ptyId, message.projectPath)
          reply({ type: 'pty_deleted', data: deleted, ptyId: message.ptyId })
          break
        }
      case 'pty_connect': {
          const oc = requireOpenCode()
          const ptyId = message.ptyId
          getPtyListeners(ptyId).add(ws)
          const existingWs = ptyConnections.get(ptyId)
          if (existingWs) {
            reply({ type: 'pty_connected', data: { ptyId } })
            break
          }
          
          const ptyWsUrl = oc.getPtyWebSocketUrl(ptyId, message.projectPath)
          
          try {
            const ptyWs = new WebSocket(ptyWsUrl)
            
            ptyWs.addEventListener('open', () => {
              ptyConnections.set(ptyId, ptyWs)
              ensurePtyHealth(ptyId)
              reply({ type: 'pty_connected', data: { ptyId } })
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
            log(`[PTY] pty_connect error: ${error}`)
            reply({ type: 'error', message: 'PTY connect failed' })
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
          reply({ type: 'pty_disconnected', data: { ptyId: message.ptyId } })
          break
        }
        case 'pty_resize': {
          const oc = requireOpenCode()
          await oc.updatePty(message.ptyId, undefined, message.rows, message.cols, message.projectPath)
          break
        }
        // Feature 15: MCP Server Management
        case 'get_mcp_status': {
          const oc = requireOpenCode()
          const status = await oc.getMcpStatus(message.projectPath)
          reply({ type: 'mcp_status', data: status })
          break
        }
        case 'connect_mcp': {
          const oc = requireOpenCode()
          const connected = await oc.connectMcp(message.name, message.projectPath)
          reply({ type: 'mcp_connected', data: connected, name: message.name })
          break
        }
        case 'disconnect_mcp': {
          const oc = requireOpenCode()
          const disconnected = await oc.disconnectMcp(message.name, message.projectPath)
          reply({ type: 'mcp_disconnected', data: disconnected, name: message.name })
          break
        }
        case 'get_mcp_resources': {
          const oc = requireOpenCode()
          const resources = await oc.getMcpResources(message.projectPath)
          reply({ type: 'mcp_resources', data: resources })
          break
        }
        // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
        case 'list_worktrees': {
          const oc = requireOpenCode()
          const worktrees = await oc.listWorktrees(message.projectPath)
          reply({ type: 'worktrees', data: worktrees })
          break
        }
        case 'create_worktree': {
          const oc = requireOpenCode()
          const worktree = await oc.createWorktree(
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
          const oc = requireOpenCode()
          const deleted = await oc.deleteWorktree(message.name, message.projectPath)
          reply({ type: 'worktree_deleted', data: deleted, name: message.name })
          break
        }
        // Feature 16: Full Provider Management
        case 'list_all_providers': {
          const oc = requireOpenCode()
          const providers = await oc.listAllProviders(message.projectPath)
          reply({ type: 'all_providers', data: providers })
          break
        }
        case 'get_provider_auth': {
          const oc = requireOpenCode()
          const auth = await oc.getProviderAuth(message.projectPath)
          reply({ type: 'provider_auth', data: auth })
          break
        }
        // Feature 17: Tool List
        case 'list_tool_ids': {
          const oc = requireOpenCode()
          const toolIds = await oc.listToolIds(message.projectPath)
          reply({ type: 'tool_ids', data: toolIds })
          break
        }
        case 'list_tools': {
          const oc = requireOpenCode()
          const tools = await oc.listTools(message.provider, message.model, message.projectPath)
          reply({ type: 'tools', data: tools })
          break
        }
        // Feature 18: File Status (Git)
        case 'get_file_status': {
          const oc = requireOpenCode()
          const fileStatus = await oc.getFileStatus(message.projectPath)
          reply({ type: 'file_status', data: fileStatus })
          break
        }
        // Feature 19: Formatter Status
        case 'get_formatter_status': {
          const oc = requireOpenCode()
          const formatterStatus = await oc.getFormatterStatus(message.projectPath)
          reply({ type: 'formatter_status', data: formatterStatus })
          break
        }
        // Feature 20: Session Init
        case 'init_session': {
          const oc = requireOpenCode()
          const initialized = await oc.initSession(
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
          const oc = requireOpenCode()
          const disposed = await oc.disposeInstance(message.projectPath)
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
        // Codex app-server protocol expects MergeStrategy on the wire as lower-case strings
        // (enum is `Replace|Upsert` in Rust with `rename_all = "camelCase"`).
        const mergeStrategyRaw = safeString(message.mergeStrategy).trim().toLowerCase()
        const mergeStrategy = mergeStrategyRaw === 'upsert' ? 'upsert' : 'replace'
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
      // Codex MCP Hot Reload (SDK feature) - reloads MCP server config without restarting
      case 'cx_mcp_reload': {
        const client = await ensureCodexClient()
        // Protocol expects params to be omitted (Option<()>).
        const result: any = await client.request('config/mcpServer/reload')
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
        // EXPERIMENTAL: `review/start` is not part of the confirmed public Codex API surface.
        // Keep this feature behind UI affordances that can be removed if the endpoint disappears.
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
        // Debug: log model being used
        console.log(`[Codex cx_chat] model=${message.model ?? 'default'}, threadId=${message.threadId ?? 'new'}, cwd=${cwd}`)

        let resolvedModel = safeString(message.model).trim()
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
          if (!resolvedModel) {
            resolvedModel = safeString(startRes?.model).trim()
          }
          console.log(`[Codex cx_chat] thread/start result: threadId=${threadId}, model=${message.model}`)
          if (threadId) {
            reply({ type: 'cx_thread_created', data: mapCodexThread(startRes.thread) })
          } else {
            console.error(`[Codex cx_chat] thread/start failed - no threadId returned`, startRes)
          }
        } else {
          // Ensure we are subscribed to events for this thread.
          const resumeRes: any = await client.request('thread/resume', {
            threadId,
            model: message.model ?? null,
            cwd,
            approvalPolicy: message.approvalPolicy ?? null,
            sandbox: message.sandbox ?? null,
            config: message.config ?? null,
            baseInstructions: message.baseInstructions ?? null,
            developerInstructions: message.developerInstructions ?? null,
          })
          if (!resolvedModel) {
            resolvedModel = safeString(resumeRes?.model).trim()
          }
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
               // Codex expects snake_case input types.
               input.push({ type: 'local_image', path: outPath })
             } else if (a.path) {
               // File/directory references via prompt hint
               const ref = a.path.startsWith('@') ? a.path : `@${a.path}`
               input[0].text = `${input[0].text}\n\nAttached context (via Broski):\n- ${a.isDirectory ? 'Directory' : 'File'}: ${ref}`
             }
           }
         }

        // Build collaboration mode object if specified.
        // Codex protocol expects: { mode: "pair_programming"|..., settings: { model, reasoning_effort?, developer_instructions? } }
        let collaborationMode: any = null
        const collabModeRaw = safeString(message.collaborationMode).trim()
        if (collabModeRaw) {
          const collabKey = collabModeRaw.replace(/[-_]/g, '').toLowerCase()
          const normalizedMode =
            collabKey === 'plan'
              ? 'plan'
              : collabKey === 'code'
                ? 'code'
                : collabKey === 'pairprogramming'
                  ? 'pair_programming'
                  : collabKey === 'execute'
                    ? 'execute'
                    : collabKey === 'custom'
                      ? 'custom'
                      : null

          const model = resolvedModel
          if (normalizedMode && model) {
            const effortRaw = safeString(message.effort).trim().toLowerCase()
            const reasoningEffort =
              effortRaw === 'none' ||
              effortRaw === 'minimal' ||
              effortRaw === 'low' ||
              effortRaw === 'medium' ||
              effortRaw === 'high' ||
              effortRaw === 'xhigh'
                ? effortRaw
                : null

            const developerInstructions = safeString(message.developerInstructions).trim()
            collaborationMode = {
              mode: normalizedMode,
              settings: {
                model,
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
                ...(developerInstructions ? { developer_instructions: developerInstructions } : {}),
              },
            }
          } else if (!model) {
            console.warn('[Codex cx_chat] collaborationMode ignored (missing model)')
          } else {
            console.warn(`[Codex cx_chat] collaborationMode ignored (unknown mode: ${collabModeRaw})`)
          }
        }

        console.log(`[Codex cx_chat] Starting turn for threadId=${threadId}, model=${message.model}`)
        
        try {
          const turnRes: any = await client.request('turn/start', {
            threadId,
            input,
            cwd,
            model: resolvedModel || null,
            effort: message.effort ?? null,
            summary: message.summary ?? null,
            approvalPolicy: message.approvalPolicy ?? null,
            sandboxPolicy: message.sandboxPolicy ?? null,
            collaborationMode,
          })

          const turnId = safeString(turnRes?.turn?.id)
          const turnStatus = safeString(turnRes?.turn?.status).toLowerCase()
          const turnError = turnRes?.turn?.error ?? turnRes?.error
          
          console.log(`[Codex cx_chat] turn/start result: turnId=${turnId}, status=${turnStatus}, model=${message.model}`)
          
          // Check if turn started with an error
          if (turnError || turnStatus === 'failed') {
            const errorMessage = typeof turnError === 'string' 
              ? turnError 
              : turnError?.message ?? turnError?.additionalDetails ?? 'Turn failed to start'
            const errorCode = turnError?.codexErrorInfo ?? turnError?.code ?? 'turn_start_failed'
            
            console.error(`[Codex cx_chat] turn/start failed:`, JSON.stringify(turnError ?? turnRes, null, 2))
            
            send(ws, {
              type: 'cx_stream',
              threadId,
              data: { 
                type: 'error', 
                message: errorMessage,
                code: typeof errorCode === 'string' ? errorCode : JSON.stringify(errorCode),
                details: turnError
              },
            })
            
            // Send idle to reset UI
            send(ws, {
              type: 'sdk_event',
              data: {
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: threadId },
                },
              },
            })
            break
          }
          
          if (!turnId) {
            console.error(`[Codex cx_chat] turn/start returned no turnId:`, JSON.stringify(turnRes, null, 2))
            send(ws, {
              type: 'cx_stream',
              threadId,
              data: { 
                type: 'error', 
                message: 'Turn failed to start - no turn ID returned',
                code: 'turn_start_no_id',
                details: turnRes
              },
            })
            break
          }
          
          cxActiveTurns.set(threadId, turnId)
        } catch (err: any) {
          // Handle request-level errors (network, timeout, app-server crash, etc.)
          const errorMessage = err?.message ?? String(err)
          console.error(`[Codex cx_chat] turn/start threw error:`, errorMessage)
          
          send(ws, {
            type: 'cx_stream',
            threadId,
            data: { 
              type: 'error', 
              message: errorMessage,
              code: 'turn_start_exception',
            },
          })
          
          // Send idle to reset UI
          send(ws, {
            type: 'sdk_event',
            data: {
              payload: {
                type: 'session.idle',
                properties: { sessionID: threadId },
              },
            },
          })
        }
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
          const backends = await getBackendsStatus()
          reply({ type: 'agents_status', data: backends })
          break
        }
        case 'oc_question_reply': {
          const oc = requireOpenCode()
          const questionId = message.questionId
          const answers = message.answers
          const directory = message.projectPath

          // Validate inputs
          if (!questionId || typeof questionId !== 'string') {
            console.error('[OC Question] Reply FAILED: Invalid or missing questionId:', questionId)
            reply({ type: 'oc_question_replied', data: false })
            break
          }
          if (!Array.isArray(answers)) {
            console.error('[OC Question] Reply FAILED: Invalid answers format (not array):', typeof answers, answers)
            reply({ type: 'oc_question_replied', data: false })
            break
          }

          if (DEBUG_RTS) {
            console.log('[OC Question] Reply received:', {
              questionId,
              answers,
              answersType: typeof answers,
              answersLength: answers.length,
              answersSample: answers.slice(0, 3),
              directory,
            })
          }

          const ok = await oc.replyToQuestion(questionId, answers, directory)
          if (DEBUG_RTS) {
            console.log('[OC Question] Reply result:', { questionId, ok })
          }
          if (!ok) {
            console.warn('[OC Question] Reply returned false - question may have been already answered or expired')
          }
          reply({ type: 'oc_question_replied', data: ok })
          break
        }
        case 'oc_question_reject': {
          const oc = requireOpenCode()
          const directory = message.projectPath
          if (DEBUG_RTS) {
            console.log('[OC Question] Reject received:', { questionId: message.questionId, directory })
          }
          const ok = await oc.rejectQuestion(message.questionId, directory)
          if (DEBUG_RTS) {
            console.log('[OC Question] Reject result:', { questionId: message.questionId, ok })
          }
          reply({ type: 'oc_question_rejected', data: ok })
          break
        }
        case 'oc_list_skills': {
          const oc = requireOpenCode()
          const skillFiles = await import('./skills')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await oc.getInstanceDirectory()
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
          const path = await skillFiles.resolveOpenCodeSkillFilePath({
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
          const path = await skillFiles.resolveOpenCodeSkillFilePath({
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
          const path = await skillFiles.resolveOpenCodeSkillFilePath({
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
          const path = await plugins.resolvePluginFilePath({
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
          const path = await plugins.resolvePluginFilePath({
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
          const path = await plugins.resolvePluginFilePath({
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
          const oc = requireOpenCode()
          const files = await import('./opencode-custom')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await oc.getInstanceDirectory()
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
          const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
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
          const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
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
          const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
          try {
            await files.deleteMarkdownFile(path)
            reply({ type: 'oc_command_file_deleted', data: { ok: true } })
          } catch {
            reply({ type: 'oc_command_file_deleted', data: { ok: false } })
          }
          break
        }
        case 'oc_list_agent_files': {
          const oc = requireOpenCode()
          const files = await import('./opencode-custom')
          // Use instance directory as fallback when no cwd is specified
          const cwd = message.cwd ?? await oc.getInstanceDirectory()
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
          const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
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
          const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
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
          const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
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
        case 'cc_rename_session': {
          const renamed = await claudeCode.renameSession(message.sessionId, message.name, message.cwd)
          reply({ type: 'cc_session_renamed', data: renamed })
          break
        }
        case 'cc_background_session': {
          // Background session support - mark session as backgrounded
          // For now, this is a client-side state change acknowledgment
          reply({ type: 'cc_session_backgrounded', data: true, sessionId: message.sessionId })
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

              if (actualSessionId) {
                emitCcStream(actualSessionId, streamMsgWithId, ws)
              } else {
                send(ws, { type: 'cc_stream', data: streamMsgWithId, sessionId: 'unknown' })
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
            const raw = message.response
            const normalized: 'once' | 'always' | 'reject' =
              raw === 'once' || raw === 'always' || raw === 'reject' ? raw : 'reject'
            waiter.resolve(normalized)
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
        case 'cc_list_agents': {
          const agents = await claudeCode.listAgents(message.cwd || message.projectPath)
          reply({ type: 'cc_agents', data: agents })
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
            if (source !== 'project' && source !== 'user') {
              reply({
                type: 'cc_command_file',
                data: { ok: false, name, source, path: '', content: '' },
              })
              break
            }
            const resolved = resolveClaudeCommandFilePath({ cwd, source, name })
            if (!resolved) {
              reply({
                type: 'cc_command_file',
                data: { ok: false, name, source, path: '', content: '' },
              })
              break
            }
            cmdPath = resolved
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

          const cmdPath = resolveClaudeCommandFilePath({ cwd, source, name })
          if (!cmdPath) {
            reply({ type: 'cc_command_saved', data: { ok: false, name, source } })
            break
          }

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

          const cmdPath = resolveClaudeCommandFilePath({ cwd, source, name })
          if (!cmdPath) {
            reply({ type: 'cc_command_deleted', data: { ok: false, name, source } })
            break
          }

          try {
            await rm(cmdPath, { force: true })
            reply({ type: 'cc_command_deleted', data: { ok: true, name, source } })
          } catch {
            reply({ type: 'cc_command_deleted', data: { ok: false, name, source } })
          }
          break
        }
        case 'cc_get_active_sessions': {
          const sessions = claudeCode
            .listActiveSessions()
            .map((s) => ({ id: s.sessionId, cwd: s.cwd, startedAt: s.startedAt }))
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
          reply({
            type: 'cc_checkpoint_rewound',
            data: {
              success,
              sessionId: message.sessionId,
              checkpointUuid: message.checkpointUuid,
            },
          })
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
	      const parsed = JSON.parse(text)
	      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
	        send(ws, { type: 'error', message: 'Invalid JSON payload' })
	        return
	      }
	      if (hasPrototypePoisonKeys(parsed)) {
	        send(ws, { type: 'error', message: 'Invalid JSON payload' })
	        return
	      }
	      message = parsed as ClientMessage & { requestId?: string }
	    } catch {
	      send(ws, { type: 'error', message: 'Invalid JSON payload' })
	      return
	    }

	    if (typeof (message as any).type !== 'string' || (message as any).type.length > 64) {
	      send(ws, { type: 'error', message: 'Invalid message type' })
	      return
	    }

    const requestId = message.requestId
    const reply = (response: ServerMessage) => {
      send(ws, requestId ? ({ ...response, requestId } as any) : response)
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
            send(ws, batchedMsg.requestId ? ({ ...response, requestId: batchedMsg.requestId } as any) : response)
          }
          
          try {
            await processSingleMessage(ws, batchedMsg, batchReply)
          } catch (batchError) {
            batchReply({ type: 'error', message: toPublicErrorMessage(batchError) })
          }
        }
      } else {
        await processSingleMessage(ws, message, reply)
      }
    } catch (error) {
      reply({ type: 'error', message: toPublicErrorMessage(error) })
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
      try {
        secureServer.stop(force)
      } catch {
        // ignore
      }
      if (loopbackServer) {
        try {
          loopbackServer.stop(force)
        } catch {
          // ignore
        }
      }
    },
    connections: () => sockets.size,
    port: () => securePort,
    funnelBackendPort: () => loopbackPort,
    authToken: () => authToken,
    tls: () => ({ enabled: !!tlsMaterial, certSha256: tlsMaterial?.certSha256 ?? null }),
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  })
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function toPublicErrorMessage(error: unknown): string {
  // Avoid leaking system details (paths, stack traces) to clients.
  if (typeof error === 'string') {
    if (error.length > 120) return 'Request failed'
    if (error.includes('/') || error.includes('\\')) return 'Request failed'
    return error
  }
  if (error instanceof Error) {
    const msg = error.message || 'Request failed'
    if (msg.length > 120) return 'Request failed'
    if (msg.includes('/') || msg.includes('\\')) return 'Request failed'
    return msg
  }
  return 'Request failed'
}
