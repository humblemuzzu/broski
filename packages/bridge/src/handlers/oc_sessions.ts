import type { ClientMessage, ServerMessage, SessionSummary } from '../types'
import {
  listSessionsFromDb as ocListSessionsFromDb,
  findOpenCodeDbPath,
} from '../connectors/opencode/oc-sqlite'

type Reply = (message: ServerMessage) => void

type OpenCodeSessionListOptions = {
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}

type OpenCodeLike = {
  listSessions: (
    projectPath?: string,
    options?: OpenCodeSessionListOptions,
  ) => Promise<SessionSummary[]>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeLike,
): Promise<boolean> {
  if (message.type !== 'list_sessions') {
    return false
  }

  const options = {
    roots: message.roots,
    start: message.start,
    cursor: message.cursor,
    search: message.search,
    limit: message.limit,
    archived: message.archived,
  }

  let sessions: SessionSummary[]

  try {
    const oc = requireOpenCode()
    sessions = await oc.listSessions(message.projectPath, options)
  } catch {
    // OpenCode server unavailable — fall back to direct SQLite read.
    // SQLite fallback does not support cursor-based pagination — return
    // empty for paginated requests to avoid returning duplicate rows.
    if (options.cursor) {
      sessions = []
    } else {
      try {
        const dbPath = findOpenCodeDbPath()
        sessions = dbPath
          ? ocListSessionsFromDb(
              {
                directory: message.projectPath,
                roots: options.roots,
                start: options.start,
                search: options.search,
                limit: options.limit,
                archived: options.archived,
              },
              dbPath,
            )
          : []
      } catch {
        // SQLite also failed (corrupt DB, missing table, etc.) — give up gracefully.
        sessions = []
      }
    }
  }

  reply({
    type: 'sessions',
    data: sessions,
    projectPath: message.projectPath,
  })

  return true
}
