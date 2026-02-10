import type { GitHandlerContext, GitReply } from './types'

export async function ensureSecureCwd(
  message: any,
  ctx: GitHandlerContext,
): Promise<string | null> {
  const projectPath = ctx.safeString(message.projectPath).trim()
  if (!projectPath) return null
  return await ctx.getSecurePath(projectPath)
}

export function errorReply(
  reply: GitReply,
  message: string,
  requestId?: string,
): void {
  reply({ type: 'error', message, ...(requestId ? { requestId } : {}) })
}
