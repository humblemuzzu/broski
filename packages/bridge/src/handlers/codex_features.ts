/**
 * Codex app-server handler for NEW features (mid-2026 SDK update):
 *   - turn/steer (nudge agent mid-turn)
 *   - thread/name/set (rename thread)
 *   - thread/unarchive
 *   - thread/compact/start
 *   - skills/remote/read + skills/remote/write
 *   - skills/config/write (enable/disable individual skills)
 *   - app/list (apps marketplace)
 *   - command/exec (one-off command)
 *   - experimentalFeature/list
 *
 * Each case is a thin adapter: validate → call JSON-RPC → reply.
 */

import type { CodexAppServerClient } from '../connectors/codex'

// Minimal context the handler needs from the outer server.
export type CodexHandlerContext = {
  ensureCodexClient: () => Promise<CodexAppServerClient>
  cxActiveTurns: Map<string, string>
  cxThreadNames: Map<string, string>
  safeString: (v: unknown) => string
}

/**
 * Returns true if this handler processed the message, false otherwise.
 * Caller should check the return value and fall through to the next handler if false.
 */
export async function handleCodexFeature(
  message: any,
  reply: (msg: any) => void,
  ctx: CodexHandlerContext,
): Promise<boolean> {
  const { ensureCodexClient, cxActiveTurns, cxThreadNames, safeString } = ctx

  switch (message.type) {
    // ── turn/steer ────────────────────────────────────────────────────
    case 'cx_steer': {
      const client = await ensureCodexClient()
      const threadId = safeString(message.threadId).trim()
      const prompt = safeString(message.prompt).trim()
      if (!threadId || !prompt) {
        reply({ type: 'error', message: 'cx_steer requires threadId and prompt' })
        break
      }
      // expectedTurnId is required by SDK (TurnSteerParams)
      const expectedTurnId = safeString(message.turnId).trim() || cxActiveTurns.get(threadId) || ''
      if (!expectedTurnId) {
        reply({ type: 'error', message: 'cx_steer requires an active turn (no turnId found)' })
        break
      }
      // SDK UserInput type: { type: "text", text, text_elements }
      const result = await client.request('turn/steer', {
        threadId,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        expectedTurnId,
      })
      reply({ type: 'cx_steered', data: result ?? { ok: true } })
      break
    }

    // ── thread/name/set ──────────────────────────────────────────────
    case 'cx_thread_rename': {
      const client = await ensureCodexClient()
      const threadId = safeString(message.threadId).trim()
      const name = safeString(message.name).trim()
      if (!threadId || !name) {
        reply({ type: 'error', message: 'cx_thread_rename requires threadId and name' })
        break
      }
      const result = await client.request('thread/name/set', { threadId, name })
      // Eagerly update the local name cache (thread/name/updated notification will also fire)
      cxThreadNames.set(threadId, name)
      reply({ type: 'cx_thread_renamed', data: result ?? { ok: true } })
      break
    }

    // ── thread/unarchive ─────────────────────────────────────────────
    case 'cx_thread_unarchive': {
      const client = await ensureCodexClient()
      const threadId = safeString(message.threadId).trim()
      if (!threadId) {
        reply({ type: 'error', message: 'cx_thread_unarchive requires threadId' })
        break
      }
      const result = await client.request('thread/unarchive', { threadId })
      reply({ type: 'cx_thread_unarchived', data: result ?? { ok: true } })
      break
    }

    // ── thread/compact/start ─────────────────────────────────────────
    case 'cx_thread_compact': {
      const client = await ensureCodexClient()
      const threadId = safeString(message.threadId).trim()
      if (!threadId) {
        reply({ type: 'error', message: 'cx_thread_compact requires threadId' })
        break
      }
      const result = await client.request('thread/compact/start', { threadId })
      reply({ type: 'cx_thread_compacted', data: result ?? { ok: true } })
      break
    }

    // ── skills/remote/read ───────────────────────────────────────────
    case 'cx_remote_skills_list': {
      const client = await ensureCodexClient()
      const result: any = await client.request('skills/remote/read', {})
      reply({ type: 'cx_remote_skills', data: result?.data ?? result ?? [] })
      break
    }

    // ── skills/remote/write (install) ────────────────────────────────
    case 'cx_remote_skill_install': {
      const client = await ensureCodexClient()
      const hazelnutId = safeString(message.hazelnutId).trim()
      const isPreload = message.isPreload === true
      if (!hazelnutId) {
        reply({ type: 'error', message: 'cx_remote_skill_install requires hazelnutId' })
        break
      }
      const result = await client.request('skills/remote/write', { hazelnutId, isPreload })
      reply({ type: 'cx_remote_skill_installed', data: result ?? { ok: true } })
      break
    }

    // ── skills/config/write (enable/disable per skill) ───────────────
    case 'cx_skill_config_write': {
      const client = await ensureCodexClient()
      const path = safeString(message.path).trim()
      const enabled = message.enabled === true
      if (!path) {
        reply({ type: 'error', message: 'cx_skill_config_write requires path' })
        break
      }
      const result = await client.request('skills/config/write', { path, enabled })
      reply({ type: 'cx_skill_config_written', data: result ?? { ok: true } })
      break
    }

    // ── app/list ─────────────────────────────────────────────────────
    case 'cx_apps_list': {
      const client = await ensureCodexClient()
      const cursor = message.cursor ?? null
      const limit = message.limit ?? null
      const result: any = await client.request('app/list', {
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      })
      reply({
        type: 'cx_apps',
        data: result?.data ?? result ?? [],
        nextCursor: result?.nextCursor ?? null,
      })
      break
    }

    // ── command/exec ─────────────────────────────────────────────────
    case 'cx_command_exec': {
      const client = await ensureCodexClient()
      const command = message.command as string[] | undefined
      if (!command || !Array.isArray(command) || command.length === 0) {
        reply({ type: 'error', message: 'cx_command_exec requires command array' })
        break
      }
      const result = await client.request('command/exec', {
        command,
        ...(message.timeoutMs ? { timeoutMs: message.timeoutMs } : {}),
        ...(message.cwd ? { cwd: message.cwd } : {}),
      })
      reply({ type: 'cx_command_result', data: result ?? {} })
      break
    }

    // ── experimentalFeature/list ─────────────────────────────────────
    case 'cx_experimental_features': {
      const client = await ensureCodexClient()
      const cursor = message.cursor ?? null
      const limit = message.limit ?? null
      const result: any = await client.request('experimentalFeature/list', {
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      })
      reply({
        type: 'cx_experimental_features_list',
        data: result?.data ?? result ?? [],
        nextCursor: result?.nextCursor ?? null,
      })
      break
    }

    default:
      return false // Not handled by this module
  }

  return true // Handled
}
