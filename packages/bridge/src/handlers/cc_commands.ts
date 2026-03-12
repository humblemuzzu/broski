import type { ServerMessage } from '../types'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

type HandlerContext = {
  claudeCode: {
    listCommands: (cwd?: string) => Promise<unknown[]>
  }
  safeString: (value: unknown) => string
  getSecurePath: (path: string) => Promise<string | null>
  isSafeClaudeCommandName: (name: string) => boolean
  resolveClaudeCommandFilePath: (params: {
    cwd: string
    source: 'project' | 'user'
    name: string
  }) => string | null
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_commands': {
      const commands = await ctx.claudeCode.listCommands(message.cwd as string | undefined)
      reply({ type: 'cc_commands', data: commands })
      return true
    }
    case 'cc_get_command': {
      const name = ctx.safeString(message.name)
      const source = message.source as string
      let cwd = ctx.safeString(message.cwd).trim() || process.cwd()

      if (!ctx.isSafeClaudeCommandName(name)) {
        reply({
          type: 'cc_command_file',
          data: { ok: false, name, source, path: '', content: '' },
        })
        return true
      }

      let cmdPath = ''
      if (source === 'plugin') {
        const requestedPath = ctx.safeString(message.path)
        if (!requestedPath) {
          reply({
            type: 'cc_command_file',
            data: { ok: false, name, source, path: '', content: '' },
          })
          return true
        }
        try {
          const pluginsModule = await import('../plugins')
          const plugins = await pluginsModule.discoverPlugins(message.cwd as string)
          const resolved = resolve(requestedPath)
          const allowed = plugins.some((p: { path: string }) => resolved.startsWith(resolve(p.path) + sep))
          if (!allowed) {
            reply({
              type: 'cc_command_file',
              data: { ok: false, name, source, path: '', content: '' },
            })
            return true
          }
          cmdPath = resolved
        } catch {
          reply({
            type: 'cc_command_file',
            data: { ok: false, name, source, path: '', content: '' },
          })
          return true
        }
      } else {
        if (source !== 'project' && source !== 'user') {
          reply({
            type: 'cc_command_file',
            data: { ok: false, name, source, path: '', content: '' },
          })
          return true
        }
        if (source === 'project') {
          const secureCwd = await ctx.getSecurePath(cwd)
          if (!secureCwd) {
            reply({
              type: 'cc_command_file',
              data: { ok: false, name, source, path: '', content: '' },
            })
            return true
          }
          cwd = secureCwd
        }
        const resolved = ctx.resolveClaudeCommandFilePath({ cwd, source: source as 'project' | 'user', name })
        if (!resolved) {
          reply({
            type: 'cc_command_file',
            data: { ok: false, name, source, path: '', content: '' },
          })
          return true
        }
        cmdPath = resolved
      }

      try {
        const content = await readFile(cmdPath, 'utf-8')
        reply({
          type: 'cc_command_file',
          data: { ok: true, name, source, path: cmdPath, content },
        })
      } catch {
        const defaultContent = ['---', `description: ${name}`, '---', ''].join('\n')
        reply({
          type: 'cc_command_file',
          data: {
            ok: false,
            name,
            source,
            path: cmdPath,
            content: defaultContent,
          },
        })
      }
      return true
    }
    case 'cc_save_command': {
      const name = ctx.safeString(message.name)
      const source = message.source as string
      let cwd = ctx.safeString(message.cwd).trim() || process.cwd()

      if (source !== 'project' && source !== 'user') {
        reply({
          type: 'cc_command_saved',
          data: { ok: false, name, source },
        })
        return true
      }
      if (!ctx.isSafeClaudeCommandName(name)) {
        reply({
          type: 'cc_command_saved',
          data: { ok: false, name, source },
        })
        return true
      }

      if (source === 'project') {
        const secureCwd = await ctx.getSecurePath(cwd)
        if (!secureCwd) {
          reply({
            type: 'cc_command_saved',
            data: { ok: false, name, source },
          })
          return true
        }
        cwd = secureCwd
      }

      const cmdPath = ctx.resolveClaudeCommandFilePath({ cwd, source: source as 'project' | 'user', name })
      if (!cmdPath) {
        reply({
          type: 'cc_command_saved',
          data: { ok: false, name, source },
        })
        return true
      }

      try {
        await mkdir(resolve(cmdPath, '..'), { recursive: true })
        await writeFile(cmdPath, message.content as string, 'utf-8')
        reply({
          type: 'cc_command_saved',
          data: { ok: true, name, source, path: cmdPath },
        })
      } catch {
        reply({
          type: 'cc_command_saved',
          data: { ok: false, name, source, path: cmdPath },
        })
      }
      return true
    }
    case 'cc_delete_command': {
      const name = ctx.safeString(message.name)
      const source = message.source as string
      let cwd = ctx.safeString(message.cwd).trim() || process.cwd()

      if (source !== 'project' && source !== 'user') {
        reply({
          type: 'cc_command_deleted',
          data: { ok: false, name, source },
        })
        return true
      }
      if (!ctx.isSafeClaudeCommandName(name)) {
        reply({
          type: 'cc_command_deleted',
          data: { ok: false, name, source },
        })
        return true
      }

      if (source === 'project') {
        const secureCwd = await ctx.getSecurePath(cwd)
        if (!secureCwd) {
          reply({
            type: 'cc_command_deleted',
            data: { ok: false, name, source },
          })
          return true
        }
        cwd = secureCwd
      }

      const cmdPath = ctx.resolveClaudeCommandFilePath({ cwd, source: source as 'project' | 'user', name })
      if (!cmdPath) {
        reply({
          type: 'cc_command_deleted',
          data: { ok: false, name, source },
        })
        return true
      }

      try {
        await rm(cmdPath, { force: true })
        reply({
          type: 'cc_command_deleted',
          data: { ok: true, name, source },
        })
      } catch {
        reply({
          type: 'cc_command_deleted',
          data: { ok: false, name, source },
        })
      }
      return true
    }
    default:
      return false
  }
}
