import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeShellLike = {
  shellCommand: (id: string, command: string, dir?: string, agent?: string, model?: string) => Promise<any>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeShellLike,
): Promise<boolean> {
  const msg = message as any
  if (msg.type !== 'oc_session_shell') return false

  const oc = requireOpenCode()
  const result = await oc.shellCommand(
    msg.sessionId,
    msg.command,
    msg.projectPath,
    msg.agent,
    msg.model,
  )
  reply({ type: 'oc_session_shell_result' as any, data: result })
  return true
}
