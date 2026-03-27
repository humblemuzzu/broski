import type {
  ServerMessage,
  ProjectSummary,
  ClaudeCodeSession,
  ClaudeCodeTranscriptMessage,
} from '../types'
import type { BroskiSessionSummary } from '../types/runtime'

type ReplyFn = (msg: ServerMessage) => void

type HandlerContext = {
  claudeCode: {
    listProjects: () => Promise<ProjectSummary[]>
    listSessions: (cwd?: string) => Promise<ClaudeCodeSession[]>
    getSession: (sessionId: string, cwd?: string) => Promise<ClaudeCodeSession | null>
    getSessionMessages: (sessionId: string, cwd?: string, limit?: number) => Promise<ClaudeCodeTranscriptMessage[]>
    deleteSession: (sessionId: string, cwd?: string) => Promise<boolean>
    forkSession: (sessionId: string, messageId: string, cwd?: string) => Promise<ClaudeCodeSession | null>
    renameSession: (sessionId: string, name: string, cwd?: string) => Promise<ClaudeCodeSession | null>
    listActiveSessions: () => { sessionId: string; cwd: string; startedAt: number | undefined }[]
  }
  mapClaudeCodeSessionToRuntimeSession: (session: ClaudeCodeSession) => BroskiSessionSummary
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_projects': {
      const projects = await ctx.claudeCode.listProjects()
      reply({ type: 'cc_projects', data: projects })
      return true
    }
    case 'cc_list_sessions': {
      const sessions = await ctx.claudeCode.listSessions(message.cwd as string | undefined)
      reply({ type: 'cc_sessions', data: sessions })
      reply({
        type: 'runtime_sessions',
        backend: 'claude-code',
        data: sessions.map(ctx.mapClaudeCodeSessionToRuntimeSession),
      })
      return true
    }
    case 'cc_get_session': {
      const session = await ctx.claudeCode.getSession(
        message.sessionId as string,
        message.cwd as string | undefined,
      )
      if (session) {
        reply({ type: 'cc_session', data: session })
      } else {
        reply({ type: 'error', message: 'Session not found' })
      }
      return true
    }
    case 'cc_get_session_messages': {
      const sessionId = message.sessionId as string
      const items = await ctx.claudeCode.getSessionMessages(
        sessionId,
        message.cwd as string | undefined,
        message.limit as number | undefined,
      )
      reply({
        type: 'cc_session_messages',
        data: items,
        sessionId,
      })
      return true
    }
    case 'cc_delete_session': {
      const sessionId = message.sessionId as string
      const deleted = await ctx.claudeCode.deleteSession(
        sessionId,
        message.cwd as string | undefined,
      )
      reply({
        type: 'cc_session_deleted',
        data: deleted,
        sessionId,
      })
      return true
    }
    case 'cc_fork_session': {
      const forked = await ctx.claudeCode.forkSession(
        message.sessionId as string,
        message.messageId as string,
        message.cwd as string | undefined,
      )
      reply({ type: 'cc_session_forked', data: forked })
      return true
    }
    case 'cc_rename_session': {
      const renamed = await ctx.claudeCode.renameSession(
        message.sessionId as string,
        message.name as string,
        message.cwd as string | undefined,
      )
      reply({ type: 'cc_session_renamed', data: renamed })
      return true
    }
    case 'cc_background_session': {
      const sessionId = message.sessionId as string
      reply({
        type: 'cc_session_backgrounded',
        data: true,
        sessionId,
      })
      return true
    }
    case 'cc_get_active_sessions': {
      const sessions = ctx.claudeCode.listActiveSessions().map((s) => ({
        id: s.sessionId,
        cwd: s.cwd,
        startedAt: s.startedAt,
      }))
      reply({ type: 'cc_active_sessions', data: sessions })
      return true
    }
    default:
      return false
  }
}
