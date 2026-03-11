import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeConfigLike = {
  getInstanceDirectory: () => Promise<string | null>
  getConfig: (dir?: string) => Promise<any>
  updateConfig: (config: any, dir?: string) => Promise<any>
  updateModel: (model: any, dir?: string) => Promise<any>
  getGlobalConfig: () => Promise<any>
  updateGlobalConfig: (config: any) => Promise<any>
}

type OcConfigCtx = {
  requireOpenCode: () => OpenCodeConfigLike
  safeString: (value: unknown) => string
  getSecurePath: (path: string) => Promise<string | null>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  ctx: OcConfigCtx,
): Promise<boolean> {
  switch (message.type) {
    case 'get_config': {
      const oc = ctx.requireOpenCode()
      const fallback = await oc.getInstanceDirectory()
      const projectPath =
        ctx.safeString(message.projectPath).trim() ||
        (fallback ? await ctx.getSecurePath(fallback) : '')
      const config = await oc.getConfig(projectPath || undefined)
      reply({ type: 'config', data: config })
      return true
    }
    case 'set_config': {
      const oc = ctx.requireOpenCode()
      const fallback = await oc.getInstanceDirectory()
      const projectPath =
        ctx.safeString(message.projectPath).trim() ||
        (fallback ? await ctx.getSecurePath(fallback) : '')
      const config = await oc.updateConfig(
        message.config,
        projectPath || undefined,
      )
      reply({ type: 'config', data: config })
      return true
    }
    case 'set_model': {
      const oc = ctx.requireOpenCode()
      await oc.updateModel(message.model, message.projectPath)
      const config = await oc.getConfig(message.projectPath)
      reply({ type: 'config', data: config })
      return true
    }
    case 'get_global_config': {
      const oc = ctx.requireOpenCode()
      const config = await oc.getGlobalConfig()
      reply({ type: 'global_config', data: config })
      return true
    }
    case 'set_global_config': {
      const oc = ctx.requireOpenCode()
      const config = await oc.updateGlobalConfig(
        (message as any).config ?? {},
      )
      reply({ type: 'global_config', data: config })
      return true
    }
    default:
      return false
  }
}
