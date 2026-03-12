import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeSessionOpsLike = {
  createSession: (dir?: string, title?: string, permission?: any, workspaceID?: string) => Promise<any>
  getSession: (id: string, dir?: string) => Promise<any>
  getSessionMessages: (id: string, dir?: string, limit?: number) => Promise<any>
  deleteSession: (id: string, dir?: string) => Promise<boolean>
  updateSession: (id: string, title?: string, archived?: any, dir?: string) => Promise<any>
  forkSession: (id: string, msgId?: string, dir?: string) => Promise<any>
  listSessionChildren: (id: string, dir?: string) => Promise<any[]>
  revertMessage: (id: string, msgId: string, partId?: string, dir?: string) => Promise<any>
  unrevertSession: (id: string, dir?: string) => Promise<any>
  shareSession: (id: string, dir?: string) => Promise<any>
  unshareSession: (id: string, dir?: string) => Promise<any>
  summarizeSession: (id: string, provID: string, modelID: string, dir?: string, auto?: boolean) => Promise<boolean>
  initSession: (id: string, provID: string, modelID: string, msgID: string, dir?: string) => Promise<boolean>
  getSessionDiff: (id: string, dir?: string, msgId?: string) => Promise<any>
  getSessionContext: (id: string, dir?: string) => Promise<any>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeSessionOpsLike,
): Promise<boolean> {
  switch (message.type) {
    case 'create_session': {
      const oc = requireOpenCode()
      const session = await oc.createSession(message.projectPath, message.title, message.permission, message.workspaceID)
      reply({ type: 'session_created', data: session })
      return true
    }
    case 'get_session': {
      const oc = requireOpenCode()
      const session = await oc.getSession(message.sessionId, message.projectPath)
      reply({ type: 'session', data: session })
      return true
    }
    case 'get_session_messages': {
      const oc = requireOpenCode()
      const messages = await oc.getSessionMessages(message.sessionId, message.projectPath, message.limit)
      reply({ type: 'session_messages', data: messages, sessionId: message.sessionId })
      return true
    }
    case 'delete_session': {
      const oc = requireOpenCode()
      const deleted = await oc.deleteSession(message.sessionId, message.projectPath)
      reply({ type: 'session_deleted', data: deleted, sessionId: message.sessionId })
      return true
    }
    case 'update_session': {
      const oc = requireOpenCode()
      const session = await oc.updateSession(message.sessionId, message.title, message.archived, message.projectPath)
      reply({ type: 'session_updated', data: session, sessionId: message.sessionId })
      return true
    }
    case 'fork_session': {
      const oc = requireOpenCode()
      const session = await oc.forkSession(message.sessionId, message.messageId, message.projectPath)
      reply({ type: 'session_forked', data: session })
      return true
    }
    case 'session_children': {
      const oc = requireOpenCode()
      const sessions = await oc.listSessionChildren(message.sessionId, message.projectPath)
      reply({ type: 'session_children', data: sessions, sessionId: message.sessionId })
      return true
    }
    case 'revert_message': {
      const oc = requireOpenCode()
      const session = await oc.revertMessage(message.sessionId, message.messageId, message.partId, message.projectPath)
      reply({ type: 'message_reverted', data: session, sessionId: message.sessionId })
      return true
    }
    case 'unrevert_session': {
      const oc = requireOpenCode()
      const session = await oc.unrevertSession(message.sessionId, message.projectPath)
      reply({ type: 'session_unreverted', data: session, sessionId: message.sessionId })
      return true
    }
    case 'share_session': {
      const oc = requireOpenCode()
      const session = await oc.shareSession(message.sessionId, message.projectPath)
      reply({ type: 'session_shared', data: session, sessionId: message.sessionId })
      return true
    }
    case 'unshare_session': {
      const oc = requireOpenCode()
      const session = await oc.unshareSession(message.sessionId, message.projectPath)
      reply({ type: 'session_unshared', data: session, sessionId: message.sessionId })
      return true
    }
    case 'summarize_session': {
      const oc = requireOpenCode()
      const success = await oc.summarizeSession(message.sessionId, message.providerID, message.modelID, message.projectPath, message.auto)
      reply({ type: 'session_summarized', data: success, sessionId: message.sessionId })
      return true
    }
    case 'init_session': {
      const oc = requireOpenCode()
      const initialized = await oc.initSession(message.sessionId, message.providerID, message.modelID, message.messageID, message.projectPath)
      reply({ type: 'session_initialized', data: initialized, sessionId: message.sessionId })
      return true
    }
    case 'diff': {
      const oc = requireOpenCode()
      const diff = await oc.getSessionDiff(message.sessionId, message.projectPath, message.messageId)
      reply({ type: 'diff', data: diff, sessionId: message.sessionId })
      return true
    }
    case 'get_session_context': {
      const oc = requireOpenCode()
      const context = await oc.getSessionContext(message.sessionId, message.projectPath)
      reply({ type: 'session_context', data: context, sessionId: message.sessionId })
      return true
    }
    default:
      return false
  }
}
