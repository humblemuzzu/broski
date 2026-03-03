import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeMessageLike = {
  deleteMessage: (
    sessionId: string,
    messageId: string,
    projectPath?: string,
  ) => Promise<boolean>
  getMessage: (
    sessionId: string,
    messageId: string,
    projectPath?: string,
  ) => Promise<unknown | null>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeMessageLike,
): Promise<boolean> {
  switch (message.type) {
    case 'oc_delete_message': {
      const oc = requireOpenCode()
      const ok = await oc.deleteMessage(
        message.sessionId,
        message.messageId,
        message.projectPath,
      )
      reply({
        type: 'oc_message_deleted',
        data: ok,
        sessionId: message.sessionId,
        messageId: message.messageId,
        requestId: message.requestId,
      })
      return true
    }
    case 'oc_get_message': {
      const oc = requireOpenCode()
      const data = await oc.getMessage(
        message.sessionId,
        message.messageId,
        message.projectPath,
      )
      reply({
        type: 'oc_message',
        data,
        sessionId: message.sessionId,
        messageId: message.messageId,
        requestId: message.requestId,
      })
      return true
    }
    default:
      return false
  }
}
