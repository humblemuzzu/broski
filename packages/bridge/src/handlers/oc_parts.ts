import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodePartsLike = {
  deletePart: (
    sessId: string,
    msgId: string,
    partId: string,
    dir?: string,
  ) => Promise<boolean>
  updatePart: (
    sessId: string,
    msgId: string,
    partId: string,
    part: any,
    dir?: string,
  ) => Promise<any>
  deleteMessage: (
    sessId: string,
    msgId: string,
    dir?: string,
  ) => Promise<boolean>
  getMessage: (
    sessId: string,
    msgId: string,
    dir?: string,
  ) => Promise<unknown | null>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodePartsLike,
): Promise<boolean> {
  switch (message.type) {
    case 'delete_part': {
      const oc = requireOpenCode()
      const ok = await oc.deletePart(
        message.sessionId,
        message.messageId,
        message.partId,
        message.projectPath,
      )
      reply({ type: 'part_deleted', data: ok })
      return true
    }
    case 'update_part': {
      const oc = requireOpenCode()
      const result = await oc.updatePart(
        message.sessionId,
        message.messageId,
        message.partId,
        message.part ?? {},
        message.projectPath,
      )
      reply({ type: 'part_updated', data: result ?? {} })
      return true
    }
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
