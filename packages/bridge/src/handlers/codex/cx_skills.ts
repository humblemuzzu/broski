/**
 * Codex skills handler.
 * Extracted from server.ts — cases: cx_skills_list, cx_get_skill, cx_save_skill,
 * cx_delete_skill, cx_list_prompts
 */

import type { CodexAppServerClient } from '../../connectors/codex'

export type CxSkillsHandlerContext = {
  ensureCodexClient: () => Promise<CodexAppServerClient>
  safeString: (v: unknown) => string
}

export async function handleCxSkills(
  message: any,
  reply: (msg: any) => void,
  ctx: CxSkillsHandlerContext,
): Promise<boolean> {
  const { ensureCodexClient, safeString } = ctx

  switch (message.type) {
    case 'cx_skills_list': {
      const client = await ensureCodexClient()
      const cwds = message.cwd ? [message.cwd] : []
      const result: any = await client.request('skills/list', {
        cwds,
        forceReload: message.forceReload === true
      })
      reply({ type: 'cx_skills', data: result?.data ?? [] })
      return true
    }
    case 'cx_get_skill': {
      const skillFiles = await import('../../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'error', message: 'Invalid skill name' })
        return true
      }
      const path = skillFiles.getCodexSkillFilePath({
        name: message.name,
        scope: message.scope,
        cwd: message.cwd
      })
      try {
        const content = await skillFiles.readSkillFile(path)
        reply({
          type: 'cx_skill',
          data: { name: message.name, path, scope: message.scope, content }
        })
      } catch {
        reply({ type: 'error', message: 'Skill not found' })
      }
      return true
    }
    case 'cx_save_skill': {
      const skillFiles = await import('../../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'cx_skill_saved', data: { ok: false } })
        return true
      }
      const path = skillFiles.getCodexSkillFilePath({
        name: message.name,
        scope: message.scope,
        cwd: message.cwd
      })
      try {
        await skillFiles.writeSkillFile(path, message.content)
        reply({ type: 'cx_skill_saved', data: { ok: true, path } })
      } catch {
        reply({ type: 'cx_skill_saved', data: { ok: false } })
      }
      return true
    }
    case 'cx_delete_skill': {
      const skillFiles = await import('../../skills')
      if (!skillFiles.validateSkillName(message.name)) {
        reply({ type: 'cx_skill_deleted', data: { ok: false } })
        return true
      }
      const path = skillFiles.getCodexSkillFilePath({
        name: message.name,
        scope: message.scope,
        cwd: message.cwd
      })
      try {
        await skillFiles.deleteSkillByPath(path)
        reply({ type: 'cx_skill_deleted', data: { ok: true } })
      } catch {
        reply({ type: 'cx_skill_deleted', data: { ok: false } })
      }
      return true
    }
    case 'cx_list_prompts': {
      const skillFiles = await import('../../skills')
      const cwd = safeString(message.cwd).trim() || undefined
      const prompts = await skillFiles.listCodexPrompts(cwd)
      reply({ type: 'cx_prompts', data: prompts })
      return true
    }
    default:
      return false
  }
}
