import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeMcpLike = {
  getMcpStatus: (dir?: string) => Promise<any>
  addMcp: (name: string, config: any, dir?: string) => Promise<any>
  connectMcp: (name: string, dir?: string) => Promise<boolean>
  disconnectMcp: (name: string, dir?: string) => Promise<boolean>
  getMcpResources: (dir?: string) => Promise<any>
  mcpAuthStart: (name: string, dir?: string) => Promise<any>
  mcpAuthCallback: (name: string, code: string, dir?: string) => Promise<boolean>
  mcpAuthAuthenticate: (name: string, dir?: string) => Promise<any>
  mcpAuthRemove: (name: string, dir?: string) => Promise<boolean>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeMcpLike,
): Promise<boolean> {
  switch (message.type) {
    case 'get_mcp_status': {
      const oc = requireOpenCode()
      const status = await oc.getMcpStatus(message.projectPath)
      reply({ type: 'mcp_status', data: status })
      return true
    }
    case 'add_mcp': {
      const oc = requireOpenCode()
      const status = await oc.addMcp(message.name, (message as any).config ?? {}, message.projectPath)
      reply({ type: 'mcp_added', data: status })
      return true
    }
    case 'connect_mcp': {
      const oc = requireOpenCode()
      const connected = await oc.connectMcp(message.name, message.projectPath)
      reply({ type: 'mcp_connected', data: connected, name: message.name })
      return true
    }
    case 'disconnect_mcp': {
      const oc = requireOpenCode()
      const disconnected = await oc.disconnectMcp(message.name, message.projectPath)
      reply({ type: 'mcp_disconnected', data: disconnected, name: message.name })
      return true
    }
    case 'get_mcp_resources': {
      const oc = requireOpenCode()
      const resources = await oc.getMcpResources(message.projectPath)
      reply({ type: 'mcp_resources', data: resources })
      return true
    }
    case 'mcp_auth_start': {
      const oc = requireOpenCode()
      const result = await oc.mcpAuthStart(message.name, message.projectPath)
      reply({ type: 'mcp_auth_started', data: result, name: message.name })
      return true
    }
    case 'mcp_auth_callback': {
      const oc = requireOpenCode()
      const ok = await oc.mcpAuthCallback(message.name, (message as any).code, message.projectPath)
      reply({ type: 'mcp_auth_completed', data: ok, name: message.name })
      return true
    }
    case 'mcp_auth_authenticate': {
      const oc = requireOpenCode()
      const result = await oc.mcpAuthAuthenticate(message.name, message.projectPath)
      reply({ type: 'mcp_auth_authenticated', data: result, name: message.name })
      return true
    }
    case 'mcp_auth_remove': {
      const oc = requireOpenCode()
      const ok = await oc.mcpAuthRemove(message.name, message.projectPath)
      reply({ type: 'mcp_auth_removed', data: ok, name: message.name })
      return true
    }
    default:
      return false
  }
}
