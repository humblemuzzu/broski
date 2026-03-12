import type { ServerMessage } from '../types'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

type HandlerContext = {
  claudeCode: {
    listMemories: (scope: string, cwd?: string) => Promise<unknown[]>
    deleteMemory: (scope: string, filename: string, cwd?: string) => Promise<boolean>
    listAgents: (cwd?: string) => Promise<unknown[]>
  }
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_memories': {
      const memories = await ctx.claudeCode.listMemories(
        message.scope as string,
        message.cwd as string | undefined,
      )
      reply({ type: 'cc_memories', data: memories })
      return true
    }
    case 'cc_delete_memory': {
      const ok = await ctx.claudeCode.deleteMemory(
        message.scope as string,
        message.filename as string,
        message.cwd as string | undefined,
      )
      reply({
        type: 'cc_memory_deleted',
        data: { ok, filename: message.filename, scope: message.scope },
      })
      return true
    }
    case 'cc_list_agents': {
      const agents = await ctx.claudeCode.listAgents(
        (message.cwd as string) || (message.projectPath as string),
      )
      reply({ type: 'cc_agents', data: agents })
      return true
    }
    default:
      return false
  }
}
