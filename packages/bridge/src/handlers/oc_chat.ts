import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeChatLike = {
  sendPromptAsync: (
    sessionId: string, content: string, dir?: string,
    model?: any, agent?: string, attachments?: any[],
    variant?: string, noReply?: boolean, system?: string,
    format?: any,
  ) => Promise<any>
  abortSession: (id: string, dir?: string) => Promise<boolean>
  respondToPermission: (id: string, response: string, message?: string, dir?: string) => Promise<boolean>
}

export type OcChatCtx = {
  requireOpenCode: () => OpenCodeChatLike
  safeString: (value: unknown) => string
  recentChatMessageIds: Map<string, number>
  sessionOwners: Map<string, unknown>
  ws: unknown
  syncExternalTailForKey: (key: string | null) => void
  makeSessionKey: (agent: string | undefined, sessionId: string | undefined) => string | null
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  ctx: OcChatCtx,
): Promise<boolean> {
  switch (message.type) {
    case 'chat': {
      const oc = ctx.requireOpenCode()
      const msgId = ctx.safeString((message as any).messageId)
      if (msgId) {
        const key = `${message.sessionId}:${msgId}`
        const now = Date.now()
        const previous = ctx.recentChatMessageIds.get(key)
        if (previous && now - previous < 120_000) {
          return true
        }
        ctx.recentChatMessageIds.set(key, now)
        if (ctx.recentChatMessageIds.size > 10_000) {
          const cutoff = now - 300_000
          for (const [k, t] of ctx.recentChatMessageIds) {
            if (t < cutoff) ctx.recentChatMessageIds.delete(k)
          }
        }
      }
      if (message.sessionId) {
        ctx.sessionOwners.set(message.sessionId, ctx.ws)
        ctx.syncExternalTailForKey(ctx.makeSessionKey('opencode', message.sessionId))
      }
      await oc.sendPromptAsync(
        message.sessionId,
        message.content,
        message.projectPath,
        message.model,
        message.agent,
        message.fileAttachments,
        message.variant,
        (message as any).noReply,
        (message as any).system,
        (message as any).format,
      )
      return true
    }
    case 'abort': {
      const oc = ctx.requireOpenCode()
      await oc.abortSession(message.sessionId, message.projectPath)
      return true
    }
    case 'permission_response': {
      const oc = ctx.requireOpenCode()
      const raw = message.response
      const normalized: 'once' | 'always' | 'reject' = raw === 'once' || raw === 'always' || raw === 'reject' ? raw : 'reject'
      await oc.respondToPermission(message.permissionId, normalized, message.message, message.projectPath)
      return true
    }
    default:
      return false
  }
}
