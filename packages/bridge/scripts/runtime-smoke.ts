import { createRequire } from 'node:module'
import * as claudeCode from '../src/connectors/claude-code'
import * as codexFs from '../src/connectors/codex-fs'
import { OpenCodeConnector } from '../src/connectors/opencode'

const require = createRequire(import.meta.url)

type ProbeResult = {
  backend: 'claude-code' | 'codex' | 'opencode'
  ok: boolean
  version?: string
  checks: string[]
  warnings: string[]
  error?: string
}

function printResult(result: ProbeResult): void {
  const status = result.ok ? 'OK' : 'WARN'
  console.log(`\n[${status}] ${result.backend}`)
  if (result.version) {
    console.log(`version: ${result.version}`)
  }
  for (const check of result.checks) {
    console.log(`- ${check}`)
  }
  for (const warning of result.warnings) {
    console.log(`! ${warning}`)
  }
  if (result.error) {
    console.log(`x ${result.error}`)
  }
}

function packageVersion(pkg: string): string | undefined {
  try {
    const json = require(`${pkg}/package.json`) as { version?: string }
    return json.version
  } catch {
    return undefined
  }
}

async function probeClaudeCode(): Promise<ProbeResult> {
  const result: ProbeResult = {
    backend: 'claude-code',
    ok: true,
    version: packageVersion('@anthropic-ai/claude-agent-sdk'),
    checks: [],
    warnings: [],
  }

  try {
    const projects = await claudeCode.listProjects()
    result.checks.push(`projects probe succeeded (${projects.length} found)`)
  } catch (error) {
    result.ok = false
    result.error = `projects probe failed: ${error instanceof Error ? error.message : String(error)}`
    return result
  }

  try {
    const sessions = await claudeCode.listSessions()
    result.checks.push(`sessions probe succeeded (${sessions.length} found)`)
    result.checks.push(`active runtime sessions in bridge memory: ${claudeCode.listActiveSessions().length}`)
  } catch (error) {
    result.ok = false
    result.error = `sessions probe failed: ${error instanceof Error ? error.message : String(error)}`
  }

  return result
}

async function probeCodex(): Promise<ProbeResult> {
  const result: ProbeResult = {
    backend: 'codex',
    ok: true,
    version: undefined,
    checks: [],
    warnings: [],
  }

  try {
    const projects = await codexFs.listProjectsFromFs()
    result.checks.push(`filesystem projects probe succeeded (${projects.length} found)`)
  } catch (error) {
    result.ok = false
    result.error = `filesystem projects probe failed: ${error instanceof Error ? error.message : String(error)}`
    return result
  }

  try {
    const threads = await codexFs.listThreadsFromFs()
    result.checks.push(`filesystem threads probe succeeded (${threads.length} found)`)
  } catch (error) {
    result.ok = false
    result.error = `filesystem threads probe failed: ${error instanceof Error ? error.message : String(error)}`
  }

  return result
}

async function probeOpenCode(): Promise<ProbeResult> {
  const result: ProbeResult = {
    backend: 'opencode',
    ok: true,
    version: packageVersion('@opencode-ai/sdk'),
    checks: [],
    warnings: [],
  }

  const connector = new OpenCodeConnector()
  const running = await connector.isRunning()
  result.checks.push(`bridge connector reachability: ${running ? 'running' : 'not running'}`)

  if (!running) {
    result.ok = false
    result.warnings.push('OpenCode server is not reachable at the default local base URL')
    return result
  }

  try {
    const instanceDirectory = await connector.getInstanceDirectory()
    result.checks.push(`instance directory probe: ${instanceDirectory ?? 'none'}`)
    const projects = await connector.listProjects()
    result.checks.push(`projects probe succeeded (${projects.length} found)`)
    const sessions = await connector.listSessions(instanceDirectory ?? undefined)
    result.checks.push(`sessions probe succeeded (${sessions.length} found)`)
  } catch (error) {
    result.ok = false
    result.error = `read-only connector probe failed: ${error instanceof Error ? error.message : String(error)}`
  }

  return result
}

async function main(): Promise<void> {
  console.log('Broski runtime smoke test')
  console.log('==========================')

  const results = await Promise.all([
    probeClaudeCode(),
    probeCodex(),
    probeOpenCode(),
  ])

  for (const result of results) {
    printResult(result)
  }

  const failing = results.filter((result) => !result.ok)
  if (failing.length > 0) {
    process.exitCode = 1
  }
}

void main()
