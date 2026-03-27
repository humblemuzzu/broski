import type { ServerMessage, ClaudeCodeHook } from '../types'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

type ReplyFn = (msg: ServerMessage) => void

type HandlerContext = {
  claudeCode: {
    listHooks: (cwd?: string) => Promise<ClaudeCodeHook[]>
  }
  safeString: (value: unknown) => string
  getSecurePath: (path: string) => Promise<string | null>
}

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
  ctx: HandlerContext,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_hooks': {
      const hooks = await ctx.claudeCode.listHooks(message.cwd as string | undefined)
      reply({ type: 'cc_hooks', data: hooks })
      return true
    }
    case 'cc_hooks_file_read': {
      // Read hooks from the first available location:
      // 1. settings.json → "hooks" key (standard Claude Code CLI approach)
      // 2. hooks/hooks.json (standalone file, used by some plugins/projects)
      // Returns merged content as {"hooks": {...}} so the Flutter UI sees everything.
      const src = message.source as 'project' | 'user'
      const cwd = ctx.safeString(message.cwd).trim()
      if (src === 'project' && !cwd) {
        reply({
          type: 'cc_hooks_file',
          data: { ok: false, source: src, path: '', content: '' },
        })
        return true
      }
      let baseDir: string
      if (src === 'project') {
        const secureCwd = await ctx.getSecurePath(cwd)
        if (!secureCwd) {
          reply({
            type: 'cc_hooks_file',
            data: { ok: false, source: src, path: '', content: '' },
          })
          return true
        }
        baseDir = secureCwd
      } else {
        baseDir = homedir()
      }

      const settingsPath = join(baseDir, '.claude', 'settings.json')
      const hooksJsonPath = join(baseDir, '.claude', 'hooks', 'hooks.json')

      // Try settings.json first (preferred, standard Claude Code convention)
      let hooksObj: Record<string, unknown> = {}
      let resolvedPath = settingsPath

      try {
        const raw = await readFile(settingsPath, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)) {
          hooksObj = parsed.hooks as Record<string, unknown>
        }
      } catch {
        // settings.json missing or no hooks key — try hooks.json
      }

      // Also merge hooks from hooks/hooks.json if present
      try {
        const raw = await readFile(hooksJsonPath, 'utf-8')
        const parsed = JSON.parse(raw) as { hooks?: Record<string, unknown> }
        if (parsed.hooks && typeof parsed.hooks === 'object') {
          for (const [event, matchers] of Object.entries(parsed.hooks)) {
            if (hooksObj[event] && Array.isArray(hooksObj[event]) && Array.isArray(matchers)) {
              // Merge: append hooks.json entries after settings.json entries
              ;(hooksObj[event] as unknown[]).push(...matchers)
            } else if (!hooksObj[event]) {
              hooksObj[event] = matchers
            }
          }
          resolvedPath = hooksJsonPath
        }
      } catch {
        // hooks.json missing — fine
      }

      const content = JSON.stringify({ hooks: hooksObj }, null, 2)
      reply({
        type: 'cc_hooks_file',
        data: { ok: true, source: src, path: resolvedPath, content },
      })
      return true
    }
    case 'cc_hooks_file_write': {
      // Write hooks to the appropriate location.
      // Strategy: if settings.json already has a "hooks" key, update it there.
      // Otherwise, write to hooks/hooks.json (backward-compatible).
      const src = message.source as 'project' | 'user'
      const cwd = ctx.safeString(message.cwd).trim()
      if (src === 'project' && !cwd) {
        reply({
          type: 'cc_hooks_file_written',
          data: { ok: false, source: src, path: '' },
        })
        return true
      }
      let baseDir: string
      if (src === 'project') {
        const secureCwd = await ctx.getSecurePath(cwd)
        if (!secureCwd) {
          reply({
            type: 'cc_hooks_file_written',
            data: { ok: false, source: src, path: '' },
          })
          return true
        }
        baseDir = secureCwd
      } else {
        baseDir = homedir()
      }

      const settingsFilePath = join(baseDir, '.claude', 'settings.json')
      const hooksJsonFilePath = join(baseDir, '.claude', 'hooks', 'hooks.json')

      try {
        // Parse the incoming content — expected shape: {"hooks": {...}}
        const incoming = JSON.parse(message.content as string) as {
          hooks?: Record<string, unknown>
        }
        const newHooks = incoming.hooks ?? {}

        // Check if settings.json exists and already has hooks
        let wroteToSettings = false
        try {
          const raw = await readFile(settingsFilePath, 'utf-8')
          const settings = JSON.parse(raw) as Record<string, unknown>
          if ('hooks' in settings || Object.keys(newHooks).length > 0) {
            // Update hooks in settings.json (preferred location)
            settings.hooks = newHooks
            await writeFile(settingsFilePath, JSON.stringify(settings, null, 2), 'utf-8')
            wroteToSettings = true
          }
        } catch {
          // settings.json doesn't exist — fall through to hooks.json
        }

        if (!wroteToSettings) {
          // Fall back to standalone hooks.json
          await mkdir(resolve(hooksJsonFilePath, '..'), { recursive: true })
          await writeFile(hooksJsonFilePath, message.content as string, 'utf-8')
        }

        const writtenPath = wroteToSettings ? settingsFilePath : hooksJsonFilePath
        reply({
          type: 'cc_hooks_file_written',
          data: { ok: true, source: src, path: writtenPath },
        })
      } catch {
        reply({
          type: 'cc_hooks_file_written',
          data: { ok: false, source: src, path: settingsFilePath },
        })
      }
      return true
    }
    case 'cc_mcp_file_read': {
      const cwd = ctx.safeString(message.cwd).trim()
      if (!cwd) {
        reply({
          type: 'cc_mcp_file',
          data: { ok: false, path: '', content: '' },
        })
        return true
      }
      const secureCwd = await ctx.getSecurePath(cwd)
      if (!secureCwd) {
        reply({
          type: 'cc_mcp_file',
          data: { ok: false, path: '', content: '' },
        })
        return true
      }
      const mcpPath = join(secureCwd, '.mcp.json')
      try {
        const content = await readFile(mcpPath, 'utf-8')
        reply({
          type: 'cc_mcp_file',
          data: { ok: true, path: mcpPath, content },
        })
      } catch {
        reply({
          type: 'cc_mcp_file',
          data: { ok: true, path: mcpPath, content: '{"mcpServers":{}}' },
        })
      }
      return true
    }
    case 'cc_mcp_file_write': {
      const cwd = ctx.safeString(message.cwd).trim()
      if (!cwd) {
        reply({ type: 'cc_mcp_file_written', data: { ok: false, path: '' } })
        return true
      }
      const secureCwd = await ctx.getSecurePath(cwd)
      if (!secureCwd) {
        reply({ type: 'cc_mcp_file_written', data: { ok: false, path: '' } })
        return true
      }
      const mcpPath = join(secureCwd, '.mcp.json')
      try {
        await writeFile(mcpPath, message.content as string, 'utf-8')
        reply({
          type: 'cc_mcp_file_written',
          data: { ok: true, path: mcpPath },
        })
      } catch {
        reply({
          type: 'cc_mcp_file_written',
          data: { ok: false, path: mcpPath },
        })
      }
      return true
    }
    default:
      return false
  }
}
