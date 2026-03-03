import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeWorkspaceLike = {
  listWorkspaces: (projectPath?: string) => Promise<unknown[]>
  createWorkspace: (
    id: string,
    options: { branch?: string | null; config?: { directory: string; type: 'worktree' } },
    projectPath?: string,
  ) => Promise<unknown | null>
  removeWorkspace: (id: string, projectPath?: string) => Promise<boolean>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeWorkspaceLike,
): Promise<boolean> {
  switch (message.type) {
    case 'oc_list_workspaces': {
      const oc = requireOpenCode()
      const workspaces = await oc.listWorkspaces(message.projectPath)
      reply({
        type: 'oc_workspaces',
        data: workspaces,
        requestId: message.requestId,
      })
      return true
    }
    case 'oc_create_workspace': {
      const oc = requireOpenCode()
      const created = await oc.createWorkspace(
        message.id,
        {
          ...(message.branch !== undefined ? { branch: message.branch } : {}),
          ...(message.configDirectory != null && message.configDirectory.length > 0
            ? {
                config: {
                  directory: message.configDirectory,
                  type: 'worktree' as const,
                },
              }
            : {}),
        },
        message.projectPath,
      )
      reply({
        type: 'oc_workspace_created',
        data: created,
        requestId: message.requestId,
      })
      return true
    }
    case 'oc_remove_workspace': {
      const oc = requireOpenCode()
      const ok = await oc.removeWorkspace(message.id, message.projectPath)
      reply({
        type: 'oc_workspace_removed',
        data: ok,
        id: message.id,
        requestId: message.requestId,
      })
      return true
    }
    default:
      return false
  }
}
