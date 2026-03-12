/**
 * Codex external agent config detection and import handler.
 * Detects configs from Claude Code, Cursor, Windsurf, etc. and imports them.
 */

import type { CodexAppServerClient } from '../../connectors/codex'

export type CxExternalConfigContext = {
  ensureCodexClient: () => Promise<CodexAppServerClient>
  safeString: (v: unknown) => string
}

export async function handleCxExternalConfig(
  message: any,
  reply: (msg: any) => void,
  ctx: CxExternalConfigContext,
): Promise<boolean> {
  switch (message.type) {
    case 'cx_external_config_detect': {
      const client = await ctx.ensureCodexClient()
      const cwds = Array.isArray(message.cwds) ? message.cwds : undefined
      const includeHome = message.includeHome !== false
      const result: any = await client.request('externalAgentConfig/detect', {
        ...(cwds ? { cwds } : {}),
        includeHome,
      })
      reply({
        type: 'cx_external_configs',
        data: result?.configs ?? result?.data ?? result ?? [],
        requestId: message.requestId,
      })
      return true
    }

    case 'cx_external_config_import': {
      const client = await ctx.ensureCodexClient()
      const source = ctx.safeString(message.source).trim()
      if (!source) {
        reply({ type: 'error', message: 'cx_external_config_import requires source' })
        return true
      }
      const result = await client.request('externalAgentConfig/import', {
        source,
        ...(message.configPath ? { configPath: message.configPath } : {}),
        ...(message.importOptions ? { importOptions: message.importOptions } : {}),
      })
      reply({
        type: 'cx_external_config_imported',
        data: result ?? { ok: true },
        requestId: message.requestId,
      })
      return true
    }

    default:
      return false
  }
}
