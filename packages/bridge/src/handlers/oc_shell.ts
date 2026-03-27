import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeShellLike = {
  shellCommand: (id: string, command: string, dir?: string, agent?: string, model?: string) => Promise<unknown>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeShellLike,
): Promise<boolean> {
  if (message.type !== 'oc_session_shell') return false

  const oc = requireOpenCode()
  const result = await oc.shellCommand(
    message.sessionId,
    message.command,
    message.projectPath,
    message.agent,
    message.model,
  )
  reply({ type: 'oc_session_shell_result', data: result })
  return true
}
