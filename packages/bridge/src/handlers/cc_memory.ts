import type { ServerMessage, ClaudeCodeMemoryEntry, ClaudeCodeFilesystemAgent } from '../types'

type ReplyFn = (msg: ServerMessage) => void

type HandlerContext = {
  claudeCode: {
    listMemories: (scope?: 'user' | 'project' | 'local', cwd?: string) => Promise<ClaudeCodeMemoryEntry[]>
    deleteMemory: (scope: 'user' | 'project' | 'local', filename: string, cwd?: string) => Promise<boolean>
    listAgents: (cwd?: string) => Promise<ClaudeCodeFilesystemAgent[]>
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
        message.scope as 'user' | 'project' | 'local' | undefined,
        message.cwd as string | undefined,
      )
      reply({ type: 'cc_memories', data: memories })
      return true
    }
    case 'cc_delete_memory': {
      const filename = message.filename as string
      const scope = message.scope as 'user' | 'project' | 'local'
      const ok = await ctx.claudeCode.deleteMemory(
        scope,
        filename,
        message.cwd as string | undefined,
      )
      reply({
        type: 'cc_memory_deleted',
        data: { ok, filename, scope },
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
