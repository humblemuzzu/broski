import type { ServerWebSocket } from 'bun'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { OpenCodeConnector } from './opencode'
import type { ClientMessage, ServerMessage } from './types'

// Direct file listing (doesn't require OpenCode SDK)
// Note: Bun supports Node.js APIs natively with better performance
async function listFilesDirectly(
  filePath: string,
): Promise<Array<{ name: string; type: 'file' | 'directory'; path: string; absolute: string }>> {
  // Expand ~ to actual home directory
  const resolvedPath = filePath === '~' || filePath.startsWith('~/')
    ? filePath.replace(/^~/, homedir())
    : resolve(filePath)

  try {
    const entries = await readdir(resolvedPath, { withFileTypes: true })
    const items: Array<{ name: string; type: 'file' | 'directory'; path: string; absolute: string }> = []

    for (const entry of entries) {
      // Skip hidden files/folders (starting with .)
      if (entry.name.startsWith('.')) continue

      const absolute = resolve(resolvedPath, entry.name)
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
    console.error(`[listFilesDirectly] Error listing ${resolvedPath}:`, error)
    return []
  }
}

async function readFileDirectly(filePath: string): Promise<{ content: string; mime: string }> {
  const resolvedPath = filePath === '~' || filePath.startsWith('~/')
    ? filePath.replace(/^~/, homedir())
    : resolve(filePath)

  try {
    const file = Bun.file(resolvedPath)
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
    console.error(`[readFileDirectly] Error reading ${resolvedPath}:`, error)
    return { content: '', mime: 'text/plain' }
  }
}

async function readFileBinaryDirectly(
  filePath: string,
  maxSizeMb: number = 10,
): Promise<{ base64: string; mime: string; size: number } | { error: 'not_found' | 'too_large'; size?: number }> {
  const resolvedPath = filePath === '~' || filePath.startsWith('~/')
    ? filePath.replace(/^~/, homedir())
    : resolve(filePath)

  try {
    const file = Bun.file(resolvedPath)
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
    console.error(`[readFileBinaryDirectly] Error reading ${resolvedPath}:`, error)
    return { error: 'not_found' }
  }
}

export type BridgeServerOptions = {
  port: number
  opencode: OpenCodeConnector
  version: string
  restartOpenCode?: () => Promise<boolean>
  logger?: (message: string) => void
}

export type BridgeServer = {
  broadcast: (message: ServerMessage) => void
  enqueueSdkEvent: (event: unknown) => void
  stop: (force?: boolean) => void
  connections: () => number
  port: () => number
}

type ConnectionContext = {
  projectPath?: string
  sessionId?: string
  lastPongAt: number
  lastRttMs: number
  pendingPing?: { id: string; sentAt: number }
  connectionType: 'local' | 'tailscale' | 'unknown'
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
  const { opencode, version, logger } = options

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
      if (serverInstance.upgrade(request)) return
      return handleHttp(request)
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        contexts.set(ws, { lastPongAt: Date.now(), lastRttMs: 0, connectionType: 'unknown' })
        log(`Client connected (${sockets.size} total)`)
        void sendStatus(ws)
      },
      close(ws) {
        sockets.delete(ws)
        contexts.delete(ws)
        const clientQ = clientQueues.get(ws)
        if (clientQ?.timer) {
          clearTimeout(clientQ.timer)
        }
        clientQueues.delete(ws)
        log(`Client disconnected (${sockets.size} total)`)
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

    // Helper to include requestId in responses
    const reply = (response: ServerMessage) => {
      send(ws, requestId ? { ...response, requestId } : response)
    }

    try {
      switch (message.type) {
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
        // Feature 21: Binary File Content Read
        case 'read_file_binary': {
          const maxSizeMb = message.maxSizeMb ?? 10
          const result = await readFileBinaryDirectly(message.path, maxSizeMb)
          if ('error' in result) {
            if (result.error === 'too_large') {
              reply({ type: 'file_too_large', path: message.path, size: result.size ?? 0, maxSize: maxSizeMb * 1024 * 1024 })
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
          const results = await opencode.searchFilesAndDirs(message.query, message.projectPath)
          reply({ type: 'files_and_dirs_found', data: results })
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
        default: {
          reply({ type: 'error', message: 'Unknown message type' })
        }
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
