import type { ServerMessage } from '../types'
import { resolve, sep } from 'node:path'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

type HandlerContext = {
  claudeCode: {
    listSkills: (cwd?: string) => Promise<unknown[]>
  }
  safeString: (value: unknown) => string
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_skills': {
      const skills = await ctx.claudeCode.listSkills(message.cwd as string | undefined)
      reply({ type: 'cc_skills', data: skills })
      return true
    }
    case 'cc_get_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name as string)) {
        reply({ type: 'error', message: 'Invalid skill name' })
        return true
      }

      let skillPath: string | null = null
      if (message.source === 'plugin') {
        const requestedPath = ctx.safeString(message.path)
        if (!requestedPath) {
          reply({ type: 'error', message: 'Missing skill path' })
          return true
        }
        try {
          const pluginsModule = await import('../plugins')
          const plugins = await pluginsModule.discoverPlugins(message.cwd as string)
          const resolved = resolve(requestedPath)
          const allowed = plugins.some((p: { path: string }) => resolved.startsWith(resolve(p.path) + sep))
          if (!allowed) {
            reply({ type: 'error', message: 'Skill path not allowed' })
            return true
          }
          skillPath = resolved
        } catch {
          reply({ type: 'error', message: 'Failed to resolve plugin skill' })
          return true
        }
      } else {
        skillPath = skillFiles.getClaudeCodeSkillFilePath({
          name: message.name as string,
          source: message.source as string,
          cwd: message.cwd as string,
        })
      }

      try {
        const content = await skillFiles.readSkillFile(skillPath)
        reply({
          type: 'cc_skill',
          data: {
            name: message.name,
            path: skillPath,
            source: message.source,
            content,
          },
        })
      } catch {
        reply({ type: 'error', message: 'Skill not found' })
      }
      return true
    }
    case 'cc_save_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name as string)) {
        reply({ type: 'cc_skill_saved', data: { ok: false } })
        return true
      }
      const path = skillFiles.getClaudeCodeSkillFilePath({
        name: message.name as string,
        source: message.source as string,
        cwd: message.cwd as string,
      })
      try {
        await skillFiles.writeSkillFile(path, message.content as string)
        reply({ type: 'cc_skill_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'cc_skill_saved', data: { ok: false } })
      }
      return true
    }
    case 'cc_delete_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name as string)) {
        reply({ type: 'cc_skill_deleted', data: { ok: false } })
        return true
      }
      const path = skillFiles.getClaudeCodeSkillFilePath({
        name: message.name as string,
        source: message.source as string,
        cwd: message.cwd as string,
      })
      try {
        await skillFiles.deleteSkillByPath(path)
        reply({ type: 'cc_skill_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'cc_skill_deleted', data: { ok: false } })
      }
      return true
    }
    default:
      return false
  }
}
