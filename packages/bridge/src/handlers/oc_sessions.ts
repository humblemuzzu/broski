import type { ClientMessage, ServerMessage, SessionSummary } from '../types'

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

  const oc = requireOpenCode()
  const sessions = await oc.listSessions(message.projectPath, {
    roots: message.roots,
    start: message.start,
    cursor: message.cursor,
    search: message.search,
    limit: message.limit,
    archived: message.archived,
  })

  reply({
    type: 'sessions',
    data: sessions,
    projectPath: message.projectPath,
  })

  return true
}
