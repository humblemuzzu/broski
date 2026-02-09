import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { findBinary } from '../../platform'
import type { CheckResult } from '../types'

const OPENCODE_FIX = 'Install OpenCode: curl -fsSL https://opencode.ai/install | bash (or bun add -g opencode-ai)'
const CLAUDE_FIX = 'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash'
const CODEX_FIX = 'Install Codex: npm i -g @openai/codex'

export async function runDependencyChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  const opencode = findBinary('opencode')
  if (!opencode) {
    results.push({
      id: 'opencode',
      category: 'dependencies',
      status: 'warning',
      message: 'OpenCode not found',
      fix: OPENCODE_FIX,
    })
  } else {
    try {
      const proc = Bun.spawnSync(['opencode', '--version'], { stdout: 'pipe', stderr: 'pipe' })
      const version = proc.stdout.toString().trim()
      results.push({
        id: 'opencode',
        category: 'dependencies',
        status: 'ok',
        message: version ? `OpenCode ${version}` : 'OpenCode found',
      })
    } catch {
      results.push({ id: 'opencode', category: 'dependencies', status: 'ok', message: 'OpenCode found' })
    }
  }

  const claude = findBinary('claude')
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY)
  const hasClaudeSettings = existsSync(resolve(homedir(), '.claude', 'settings.json'))
  if (!claude) {
    results.push({
      id: 'claude_code',
      category: 'dependencies',
      status: 'warning',
      message: 'Claude Code not found',
      fix: CLAUDE_FIX,
    })
  } else {
    const auth = hasAnthropicKey ? 'API key set' : hasClaudeSettings ? 'settings.json found' : 'auth not configured'
    results.push({
      id: 'claude_code',
      category: 'dependencies',
      status: 'ok',
      message: `Claude Code found (${auth})`,
    })
  }

  const codex = findBinary('codex')
  if (!codex) {
    results.push({
      id: 'codex',
      category: 'dependencies',
      status: 'warning',
      message: 'Codex not found',
      fix: CODEX_FIX,
    })
  } else {
    results.push({ id: 'codex', category: 'dependencies', status: 'ok', message: 'Codex found' })
  }

  const any = Boolean(opencode || claude || codex)
  if (!any) {
    results.push({
      id: 'any_agent',
      category: 'dependencies',
      status: 'error',
      message: 'No supported AI backend found (OpenCode/Claude/Codex)',
      fix: OPENCODE_FIX,
    })
  } else {
    const names = [opencode && 'OpenCode', claude && 'Claude Code', codex && 'Codex'].filter(Boolean)
    results.push({
      id: 'any_agent',
      category: 'dependencies',
      status: 'ok',
      message: `Available backends: ${names.join(', ')}`,
    })
  }

  return results
}
