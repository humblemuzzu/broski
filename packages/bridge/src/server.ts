import type { ServerWebSocket } from 'bun'
import type { OpenCodeConnector } from './opencode'
import type { ClientMessage, ServerMessage } from './types'

export type BridgeServerOptions = {
  port: number
  opencode: OpenCodeConnector
  version: string
  logger?: (message: string) => void
}

export type BridgeServer = {
  broadcast: (message: ServerMessage) => void
  stop: () => void
  connections: () => number
}

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const sockets = new Set<ServerWebSocket<unknown>>()
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
        const data = await opencode.listFiles(path)
        return jsonResponse({ path, items: data })
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
        log(`Client connected (${sockets.size} total)`)
        void sendStatus(ws)
      },
      close(ws) {
        sockets.delete(ws)
        log(`Client disconnected (${sockets.size} total)`)
      },
      message(ws, raw) {
        void handleMessage(ws, raw)
      },
    },
  })

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
        case 'list_projects': {
          const projects = await opencode.listProjects()
          reply({ type: 'projects', data: projects })
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
        case 'start_opencode': {
          const started = await opencode.startServer()
          broadcast({ type: 'status', data: { opencodeRunning: started } })
          if (!started) {
            reply({
              type: 'error',
              message: 'Failed to start OpenCode. Run `opencode serve` on your Mac.',
            })
          }
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
          await opencode.sendPrompt(message.sessionId, message.content, message.projectPath, message.model)
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
          const items = await opencode.listFiles(message.path, message.projectPath)
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
    stop: () => server.stop(true),
    connections: () => sockets.size,
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
