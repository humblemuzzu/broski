import type { ClientMessage, ServerMessage } from '../types'

type Reply = (message: ServerMessage) => void

type OpenCodeCustomizationLike = {
  getInstanceDirectory: () => Promise<string | null>
}

export type OcCustomizationCtx = {
  requireOpenCode: () => OpenCodeCustomizationLike
  safeString: (value: unknown) => string
  getSecurePath: (path: string) => Promise<string | null>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  ctx: OcCustomizationCtx,
): Promise<boolean> {
  switch (message.type) {
    // ── Skills ─────────────────────────────────────────
    case 'oc_list_skills': {
      const oc = ctx.requireOpenCode()
      const skillFiles = await import('../skills')
      const fallback = await oc.getInstanceDirectory()
      const cwd = ctx.safeString(message.cwd).trim() || (fallback ? await ctx.getSecurePath(fallback) : '')
      const data = await skillFiles.listOpenCodeSkills(cwd || undefined)
      reply({ type: 'oc_skills', data })
      return true
    }
    case 'oc_get_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'error', message: 'Invalid skill name' })
        return true
      }
      const path = await skillFiles.resolveOpenCodeSkillFilePath({
        name: message.name, source: message.source, cwd: message.cwd,
      })
      try {
        const content = await skillFiles.readSkillFile(path)
        reply({ type: 'oc_skill', data: { name: message.name, path, source: message.source, content } })
      } catch {
        reply({ type: 'error', message: 'Skill not found' })
      }
      return true
    }
    case 'oc_save_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'oc_skill_saved', data: { ok: false } })
        return true
      }
      const path = await skillFiles.resolveOpenCodeSkillFilePath({
        name: message.name, source: message.source, cwd: message.cwd,
      })
      try {
        await skillFiles.writeSkillFile(path, message.content)
        reply({ type: 'oc_skill_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'oc_skill_saved', data: { ok: false } })
      }
      return true
    }
    case 'oc_delete_skill': {
      const skillFiles = await import('../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'oc_skill_deleted', data: { ok: false } })
        return true
      }
      const path = await skillFiles.resolveOpenCodeSkillFilePath({
        name: message.name, source: message.source, cwd: message.cwd,
      })
      try {
        await skillFiles.deleteSkillByPath(path)
        reply({ type: 'oc_skill_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'oc_skill_deleted', data: { ok: false } })
      }
      return true
    }

    // ── Plugins ────────────────────────────────────────
    case 'oc_list_plugin_files': {
      const plugins = await import('../opencode-plugins')
      const data = await plugins.listPluginFiles(message.cwd)
      reply({ type: 'oc_plugin_files', data })
      return true
    }
    case 'oc_get_plugin_file': {
      const plugins = await import('../opencode-plugins')
      if (!plugins.validatePluginFilename(message.name)) {
        reply({ type: 'error', message: 'Invalid plugin filename' })
        return true
      }
      const path = await plugins.resolvePluginFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        const content = await plugins.readPluginFile(path)
        reply({ type: 'oc_plugin_file', data: { name: message.name, path, source: message.source, content } })
      } catch {
        reply({ type: 'error', message: 'Plugin file not found' })
      }
      return true
    }
    case 'oc_save_plugin_file': {
      const plugins = await import('../opencode-plugins')
      if (!plugins.validatePluginFilename(message.name)) {
        reply({ type: 'oc_plugin_file_saved', data: { ok: false } })
        return true
      }
      const path = await plugins.resolvePluginFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await plugins.writePluginFile(path, message.content)
        reply({ type: 'oc_plugin_file_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'oc_plugin_file_saved', data: { ok: false } })
      }
      return true
    }
    case 'oc_delete_plugin_file': {
      const plugins = await import('../opencode-plugins')
      if (!plugins.validatePluginFilename(message.name)) {
        reply({ type: 'oc_plugin_file_deleted', data: { ok: false } })
        return true
      }
      const path = await plugins.resolvePluginFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await plugins.deletePluginFile(path)
        reply({ type: 'oc_plugin_file_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'oc_plugin_file_deleted', data: { ok: false } })
      }
      return true
    }

    // ── Commands ───────────────────────────────────────
    case 'oc_list_command_files': {
      const oc = ctx.requireOpenCode()
      const files = await import('../opencode-custom')
      const fallback = await oc.getInstanceDirectory()
      const cwd = ctx.safeString(message.cwd).trim() || (fallback ? await ctx.getSecurePath(fallback) : '')
      const data = await files.listCommandFiles(cwd || undefined)
      reply({ type: 'oc_command_files', data })
      return true
    }
    case 'oc_get_command_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'error', message: 'Invalid command name' })
        return true
      }
      const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        const content = await files.readMarkdownFile(path)
        reply({ type: 'oc_command_file', data: { name: message.name, path, source: message.source, content } })
      } catch {
        reply({ type: 'error', message: 'Command file not found' })
      }
      return true
    }
    case 'oc_save_command_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'oc_command_file_saved', data: { ok: false } })
        return true
      }
      const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await files.writeMarkdownFile(path, message.content)
        reply({ type: 'oc_command_file_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'oc_command_file_saved', data: { ok: false } })
      }
      return true
    }
    case 'oc_delete_command_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'oc_command_file_deleted', data: { ok: false } })
        return true
      }
      const path = await files.resolveCommandFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await files.deleteMarkdownFile(path)
        reply({ type: 'oc_command_file_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'oc_command_file_deleted', data: { ok: false } })
      }
      return true
    }

    // ── Agents ─────────────────────────────────────────
    case 'oc_list_agent_files': {
      const oc = ctx.requireOpenCode()
      const files = await import('../opencode-custom')
      const fallback = await oc.getInstanceDirectory()
      const cwd = ctx.safeString(message.cwd).trim() || (fallback ? await ctx.getSecurePath(fallback) : '')
      const data = await files.listAgentFiles(cwd || undefined)
      reply({ type: 'oc_agent_files', data })
      return true
    }
    case 'oc_get_agent_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'error', message: 'Invalid agent name' })
        return true
      }
      const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        const content = await files.readMarkdownFile(path)
        reply({ type: 'oc_agent_file', data: { name: message.name, path, source: message.source, content } })
      } catch {
        reply({ type: 'error', message: 'Agent file not found' })
      }
      return true
    }
    case 'oc_save_agent_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'oc_agent_file_saved', data: { ok: false } })
        return true
      }
      const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await files.writeMarkdownFile(path, message.content)
        reply({ type: 'oc_agent_file_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'oc_agent_file_saved', data: { ok: false } })
      }
      return true
    }
    case 'oc_delete_agent_file': {
      const files = await import('../opencode-custom')
      if (!files.validateName(message.name)) {
        reply({ type: 'oc_agent_file_deleted', data: { ok: false } })
        return true
      }
      const path = await files.resolveAgentFilePath({ name: message.name, source: message.source, cwd: message.cwd })
      try {
        await files.deleteMarkdownFile(path)
        reply({ type: 'oc_agent_file_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'oc_agent_file_deleted', data: { ok: false } })
      }
      return true
    }

    default:
      return false
  }
}
