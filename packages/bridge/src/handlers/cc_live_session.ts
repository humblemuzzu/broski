import type { ServerMessage } from '../types'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

type HandlerContext = {
  claudeCode: {
    stopTask: (sessionId: string, taskId: string) => Promise<boolean>
    reconnectMcpServer: (sessionId: string, serverName: string) => Promise<boolean>
    toggleMcpServer: (sessionId: string, serverName: string, enabled: boolean) => Promise<boolean>
    setPermissionMode: (sessionId: string, mode: string) => Promise<boolean>
    setModel: (sessionId: string, model: string) => Promise<boolean>
    getInitializationResult: (sessionId: string) => Promise<unknown>
    setMcpServers: (sessionId: string, servers: Record<string, unknown>) => Promise<unknown>
  }
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_stop_task': {
      const ok = await ctx.claudeCode.stopTask(
        message.sessionId as string,
        message.taskId as string,
      )
      reply({
        type: 'cc_task_stopped',
        data: { ok, taskId: message.taskId },
      })
      return true
    }
    case 'cc_reconnect_mcp_server': {
      const ok = await ctx.claudeCode.reconnectMcpServer(
        message.sessionId as string,
        message.serverName as string,
      )
      reply({
        type: 'cc_mcp_server_reconnected',
        data: { ok, serverName: message.serverName },
      })
      return true
    }
    case 'cc_toggle_mcp_server': {
      const ok = await ctx.claudeCode.toggleMcpServer(
        message.sessionId as string,
        message.serverName as string,
        message.enabled as boolean,
      )
      reply({
        type: 'cc_mcp_server_toggled',
        data: {
          ok,
          serverName: message.serverName,
          enabled: message.enabled,
        },
      })
      return true
    }
    case 'cc_set_permission_mode': {
      const ok = await ctx.claudeCode.setPermissionMode(
        message.sessionId as string,
        message.mode as string,
      )
      reply({
        type: 'cc_permission_mode_set',
        data: { ok, mode: message.mode },
      })
      return true
    }
    case 'cc_set_model': {
      const ok = await ctx.claudeCode.setModel(
        message.sessionId as string,
        message.model as string,
      )
      reply({ type: 'cc_model_set', data: { ok, model: message.model } })
      return true
    }
    case 'cc_initialization_result': {
      const result = await ctx.claudeCode.getInitializationResult(
        message.sessionId as string,
      )
      reply({ type: 'cc_initialization_result', data: result })
      return true
    }
    case 'cc_set_mcp_servers': {
      const result = await ctx.claudeCode.setMcpServers(
        message.sessionId as string,
        message.servers as Record<string, unknown>,
      )
      reply({ type: 'cc_mcp_servers_set', data: result })
      return true
    }
    default:
      return false
  }
}
