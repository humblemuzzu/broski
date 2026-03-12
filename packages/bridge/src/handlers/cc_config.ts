import type { ServerMessage } from '../types'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

type HandlerContext = {
  claudeCode: {
    getConfig: (cwd?: string) => Promise<unknown>
    setConfig: (config: unknown, cwd?: string) => Promise<unknown>
    getSupportedModels: (cwd?: string) => Promise<unknown[]>
    getAccountInfo: (cwd?: string) => Promise<unknown>
    getMcpServerStatus: (cwd?: string) => Promise<unknown>
    rewindToCheckpoint: (
      sessionId: string,
      checkpointUuid: string,
      cwd?: string,
    ) => Promise<{
      success: boolean
      filesChanged?: unknown
      insertions?: number
      deletions?: number
    }>
  }
  mapClaudeCodeModelToSummary: (model: unknown) => unknown
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_get_config': {
      const config = await ctx.claudeCode.getConfig(message.cwd as string | undefined)
      reply({ type: 'cc_config', data: config })
      return true
    }
    case 'cc_set_config': {
      const config = await ctx.claudeCode.setConfig(message.config, message.cwd as string | undefined)
      reply({ type: 'cc_config_updated', data: config })
      return true
    }
    case 'cc_get_supported_models': {
      const models = await ctx.claudeCode.getSupportedModels(message.cwd as string | undefined)
      reply({ type: 'cc_supported_models', data: models })
      reply({
        type: 'runtime_models',
        backend: 'claude-code',
        data: (models as unknown[]).map(ctx.mapClaudeCodeModelToSummary),
      })
      return true
    }
    case 'cc_get_account_info': {
      const accountInfo = await ctx.claudeCode.getAccountInfo(message.cwd as string | undefined)
      reply({ type: 'cc_account_info', data: accountInfo })
      return true
    }
    case 'cc_get_mcp_server_status': {
      const statuses = await ctx.claudeCode.getMcpServerStatus(message.cwd as string | undefined)
      reply({ type: 'cc_mcp_server_status', data: statuses })
      return true
    }
    case 'cc_rewind_checkpoint': {
      const result = await ctx.claudeCode.rewindToCheckpoint(
        message.sessionId as string,
        message.checkpointUuid as string,
        message.cwd as string | undefined,
      )
      reply({
        type: 'cc_checkpoint_rewound',
        data: {
          success: result.success,
          sessionId: message.sessionId,
          checkpointUuid: message.checkpointUuid,
          ...(result.filesChanged ? { filesChanged: result.filesChanged } : {}),
          ...(typeof result.insertions === 'number' ? { insertions: result.insertions } : {}),
          ...(typeof result.deletions === 'number' ? { deletions: result.deletions } : {}),
        },
      })
      return true
    }
    default:
      return false
  }
}
