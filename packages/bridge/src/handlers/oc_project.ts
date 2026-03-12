import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeProjectLike = {
  initGit: (dir?: string) => Promise<any>
  getPaths: (dir?: string) => Promise<any>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeProjectLike,
): Promise<boolean> {
  switch (message.type) {
    case 'oc_init_git': {
      const oc = requireOpenCode()
      const result = await oc.initGit(message.projectPath)
      reply({ type: 'oc_git_initialized', data: result, requestId: message.requestId })
      return true
    }
    case 'oc_get_paths': {
      const oc = requireOpenCode()
      const result = await oc.getPaths(message.projectPath)
      reply({ type: 'oc_paths', data: result, requestId: message.requestId })
      return true
    }
    default:
      return false
  }
}
