import type { ServerWebSocket } from 'bun'
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { OpenCodeConnector } from './connectors/opencode'
import type { AgentType, ClientMessage, DeviceInfo, FileAttachment, ServerMessage } from './types'
import * as claudeCode from './connectors/claude-code'
import * as fileSearch from './file-search'

const TOKEN_FILE = resolve(homedir(), '.broski', 'token')

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

async function isPathAllowed(requestedPath: string): Promise<boolean> {
  try {
    const expandedPath = requestedPath.startsWith('~')
      ? requestedPath.replace(/^~/, homedir())
      : resolve(requestedPath)
    
    const realPath = await realpath(expandedPath).catch(() => null)
    if (!realPath) return false
    
    return SECURITY_ALLOWED_BASE_PATHS.some(base => 
      realPath === base || realPath.startsWith(base + sep)
    )
  } catch {
    return false
  }
}

async function getSecurePath(requestedPath: string): Promise<string | null> {
  const expandedPath = requestedPath.startsWith('~')
    ? requestedPath.replace(/^~/, homedir())
    : resolve(requestedPath)
  
  const allowed = await isPathAllowed(expandedPath)
  if (!allowed) return null
  
  return expandedPath
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
  'permission.replied': 'immediate',
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
  const ptyConnections = new Map<string, WebSocket>()
  const ccPermissionWaiters = new Map<
    string,
    { resolve: (response: 'once' | 'always' | 'reject') => void; timer: Timer }
  >()
  const { opencode, version, logger } = options
  
  let currentAgent: AgentType = options.currentAgent || 'opencode'
  
  const authToken = options.authToken || generateAuthToken()

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

  let eventCount = 0
  let eventCountResetTimer: Timer | null = null

  const extractSessionId = (event: any): string | null => {
    const payload = event?.payload ?? null
    const properties = payload?.properties ?? null
    const info = properties?.info ?? null
    const sessionId =
      (typeof info?.sessionID === 'string' && info.sessionID) ||
      (typeof properties?.sessionID === 'string' && properties.sessionID) ||
      (typeof properties?.sessionId === 'string' && properties.sessionId)
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
      return true
    }

    const e = event as any
    const directory = (typeof e?.directory === 'string' ? e.directory : null) ?? 'global'

    if (ctx.projectPath === 'global') {
      if (directory !== 'global') return false
    } else if (ctx.projectPath && directory !== 'global' && directory !== ctx.projectPath) {
      return false
    }

    if (ctx.sessionId) {
      const sid = extractSessionId(event)
      if (sid && sid !== ctx.sessionId) {
        return false
      }
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

    for (const ws of sockets) {
      if (!filterEventForSocket(ws, event)) continue

      if (priority === 'immediate') {
        send(ws, { type: 'sdk_event', data: event })
      } else {
        enqueueForClient(ws, event)
      }
    }
  }

  const HEARTBEAT_INTERVAL_MS = 20000
  const HEARTBEAT_DEAD_AFTER_MS = 90000

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
        
        sockets.delete(ws)
        contexts.delete(ws)
        const clientQ = clientQueues.get(ws)
        if (clientQ?.timer) {
          clearTimeout(clientQ.timer)
        }
        clientQueues.delete(ws)
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
          contexts.set(ws, {
            ...existing,
            projectPath: message.projectPath || undefined,
            sessionId: message.sessionId || undefined,
          })
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
          const config = await opencode.getConfig()
          reply({ type: 'config', data: config })
          break
        }
        case 'set_model': {
          await opencode.updateModel(message.model)
          const config = await opencode.getConfig()
          reply({ type: 'config', data: config })
          break
        }
        case 'create_session': {
          const session = await opencode.createSession(message.projectPath, message.title)
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
          await opencode.sendPrompt(
            message.sessionId,
            message.content,
            message.projectPath,
            message.model,
            message.agent,
            message.disabledTools,
            message.fileAttachments,
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
          await opencode.respondToPermission(
            message.sessionId,
            message.permissionId,
            message.response,
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
          const ptys = await opencode.listPty(message.projectPath)
          reply({ type: 'pty_list', data: ptys })
          break
        }
        case 'create_pty': {
          const pty = await opencode.createPty(
            message.command,
            message.args,
            message.cwd,
            message.title,
            message.projectPath,
          )
          if (pty) {
            reply({ type: 'pty_created', data: pty })
          } else {
            reply({ type: 'error', message: 'Failed to create PTY session' })
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
          const existingWs = ptyConnections.get(ptyId)
          if (existingWs) {
            reply({ type: 'pty_connected', ptyId })
            break
          }
          
          const ptyWsUrl = opencode.getPtyWebSocketUrl(ptyId, message.projectPath)
          log(`Connecting to PTY WebSocket: ${ptyWsUrl}`)
          
          try {
            const ptyWs = new WebSocket(ptyWsUrl)
            
            ptyWs.onopen = () => {
              ptyConnections.set(ptyId, ptyWs)
              reply({ type: 'pty_connected', ptyId })
              log(`PTY ${ptyId} connected`)
            }
            
            ptyWs.onmessage = (event) => {
              const data = typeof event.data === 'string' ? event.data : event.data.toString()
              send(ws, { type: 'pty_output', ptyId, data })
            }
            
            ptyWs.onerror = (error) => {
              log(`PTY ${ptyId} error: ${error}`)
              reply({ type: 'error', message: `PTY connection failed: ${error}` })
            }
            
            ptyWs.onclose = (event) => {
              ptyConnections.delete(ptyId)
              send(ws, { type: 'pty_exit', ptyId, exitCode: event.code })
              log(`PTY ${ptyId} closed with code ${event.code}`)
            }
          } catch (error) {
            reply({ type: 'error', message: `PTY connect failed: ${error}` })
          }
          break
        }
        case 'pty_input': {
          const ptyWs = ptyConnections.get(message.ptyId)
          if (ptyWs && ptyWs.readyState === WebSocket.OPEN) {
            ptyWs.send(message.data)
          }
          break
        }
        case 'pty_disconnect': {
          const ptyWs = ptyConnections.get(message.ptyId)
          if (ptyWs) {
            ptyWs.close()
            ptyConnections.delete(message.ptyId)
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
        case 'set_agent': {
          currentAgent = message.agent
          log(`Agent switched to: ${currentAgent}`)
          if (currentAgent === 'claude-code') {
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
          break
        }
        case 'get_agents_status': {
          const opencodeRunning = await opencode.isRunning()
          const claudeCodeAvailable = await claudeCode.checkClaudeCodeAvailable()
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
            },
          })
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
          const cfg = claudeCode.getConfig()
          const model = message.model || cfg.model || 'sonnet'
          const permissionMode = message.permissionMode || cfg.permissionMode
          const allowedTools = message.allowedTools || cfg.allowedTools
          const disallowedTools = message.disallowedTools || cfg.disallowedTools

          const available = await claudeCode.checkClaudeCodeAvailable()
          if (!available) {
            const err = 'Claude Code auth not configured (set ANTHROPIC_API_KEY or run `claude login`).'
            log(`[Claude Code] ${err}`)
            send(ws, {
              type: 'cc_stream',
              data: { type: 'error', message: err, code: 'cc_auth_missing' },
              sessionId: actualSessionId || 'unknown',
            })
            break
          }

          log(
            `[Claude Code] chat: ${message.sessionId ? 'resume' : 'new'} cwd=${cwd} model=${model} permissionMode=${permissionMode}`,
          )
          log(
            `[Claude Code] tools: allowed=${allowedTools.length} disallowed=${disallowedTools.length}`,
          )

          claudeCode.queryClaudeCode(
            message.prompt,
            {
              cwd,
              sessionId: message.sessionId,
              model,
              permissionMode,
              allowedTools,
              disallowedTools,
              maxThinkingTokens: message.maxThinkingTokens,
              systemPrompt: message.systemPrompt ?? cfg.systemPrompt,
            },
            (streamMsg) => {
              if ((streamMsg as any)?.type === 'session-created' && typeof (streamMsg as any)?.sessionId === 'string') {
                actualSessionId = (streamMsg as any).sessionId
                log(`[Claude Code] session created: ${actualSessionId}`)
              }
              send(ws, { type: 'cc_stream', data: streamMsg, sessionId: actualSessionId })
            },
            (completedSessionId) => {
              log(`Claude Code session ${completedSessionId} completed`)
            },
            (error) => {
              log(`[Claude Code] error: ${error.message}`)
              send(ws, {
                type: 'cc_stream',
                data: { type: 'error', message: error.message, code: 'cc_error' },
                sessionId: actualSessionId || message.sessionId || 'unknown',
              })
            },
            async (req) => {
              const sid = req.sessionId || actualSessionId
              if (sid) actualSessionId = sid

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
        case 'cc_list_hooks': {
          const hooks = await claudeCode.listHooks(message.cwd)
          reply({ type: 'cc_hooks', data: hooks })
          break
        }
        case 'cc_list_commands': {
          const commands = await claudeCode.listCommands(message.cwd)
          reply({ type: 'cc_commands', data: commands })
          break
        }
        case 'cc_get_config': {
          const config = claudeCode.getConfig()
          reply({ type: 'cc_config', data: config })
          break
        }
        case 'cc_set_config': {
          const config = claudeCode.setConfig(message.config)
          reply({ type: 'cc_config_updated', data: config })
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
