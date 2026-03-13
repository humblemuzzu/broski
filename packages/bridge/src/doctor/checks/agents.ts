import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { CheckResult } from '../types'
import { dirExists } from '../utils'
import { findBinary } from '../../platform'

export async function runAgentChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  try {
    const response = await fetch('http://127.0.0.1:4096/path', { signal: AbortSignal.timeout(2000) })
    if (response.ok) {
      results.push({
        id: 'opencode_reachable',
        category: 'agents',
        status: 'ok',
        message: 'OpenCode server responding on :4096',
      })
    } else {
      results.push({
        id: 'opencode_reachable',
        category: 'agents',
        status: 'info',
        message: `OpenCode probe returned HTTP ${response.status}`,
      })
    }
  } catch {
    results.push({
      id: 'opencode_reachable',
      category: 'agents',
      status: 'info',
      message: 'No OpenCode server detected (managed mode starts it automatically)',
    })
  }

  const ccProjects = resolve(homedir(), '.claude', 'projects')
  results.push({
    id: 'claude_projects',
    category: 'agents',
    status: (await dirExists(ccProjects)) ? 'info' : 'info',
    message: (await dirExists(ccProjects))
      ? 'Claude Code projects directory exists'
      : 'No Claude Code projects directory found yet',
  })

  const codexDirs = [resolve(homedir(), '.codex'), resolve(homedir(), '.openai')]
  let codexPath: string | null = null
  for (const path of codexDirs) {
    if (await dirExists(path)) {
      codexPath = path
      break
    }
  }
  results.push({
    id: 'codex_home',
    category: 'agents',
    status: 'info',
    message: codexPath ? `Codex config directory found: ${codexPath}` : 'No Codex config directory found yet',
  })

  // Pi config check
  try {
    const piPath = findBinary('pi')
    if (piPath) {
      results.push({
        id: 'pi_config',
        category: 'agents',
        status: 'ok',
        message: 'Pi agent available',
      })
    } else {
      results.push({
        id: 'pi_config',
        category: 'agents',
        status: 'info',
        message: 'Pi agent not installed (optional)',
      })
    }
  } catch {
    results.push({
      id: 'pi_config',
      category: 'agents',
      status: 'info',
      message: 'Pi agent not installed (optional)',
    })
  }

  return results
}
