import { readFile } from 'node:fs/promises'
import { checkPortInUse } from '../../platform'
import type { DoctorContext } from '../context'
import type { CheckResult } from '../types'
import { fileExists } from '../utils'

export async function runConnectivityChecks(ctx: DoctorContext, opts: { deep?: boolean } = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  try {
    const res = await fetch('https://broskiapp.com', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'broski-doctor' },
    })
    if (res.status < 500) {
      results.push({ id: 'internet', category: 'connectivity', status: 'ok', message: 'Internet reachable (broskiapp.com)' })
    } else {
      results.push({
        id: 'internet',
        category: 'connectivity',
        status: 'warning',
        message: `Internet probe returned HTTP ${res.status}`,
      })
    }
  } catch {
    results.push({
      id: 'internet',
      category: 'connectivity',
      status: 'warning',
      message: 'Cannot reach broskiapp.com',
      fix: 'Check internet connection',
    })
  }

  const listening = await checkPortInUse(ctx.port)
  if (listening) {
    results.push({ id: 'bridge_port_listening', category: 'connectivity', status: 'ok', message: `Bridge listening on port ${ctx.port}` })
  } else {
    results.push({
      id: 'bridge_port_listening',
      category: 'connectivity',
      status: 'warning',
      message: `Bridge not listening on configured port ${ctx.port}`,
      fix: 'Run `broski restart` or start manually with `broski`',
    })
  }

  const tokenExists = await fileExists(ctx.paths.tokenFile)
  if (!tokenExists) {
    results.push({
      id: 'qr_data',
      category: 'connectivity',
      status: 'warning',
      message: 'Token file missing — QR pairing unavailable until token is created',
      fix: 'Run `broski` once, then `broski qr`',
    })
  } else {
    try {
      const raw = await readFile(ctx.paths.tokenFile, 'utf-8')
      const parsed = JSON.parse(raw) as { token?: string }
      if (typeof parsed.token === 'string' && parsed.token.length >= 16) {
        results.push({ id: 'qr_data', category: 'connectivity', status: 'ok', message: 'QR data valid (token present)' })
      } else {
        results.push({
          id: 'qr_data',
          category: 'connectivity',
          status: 'warning',
          message: 'Token file exists but token looks invalid',
          fix: 'Run `broski --new-token`',
        })
      }
    } catch {
      results.push({
        id: 'qr_data',
        category: 'connectivity',
        status: 'warning',
        message: 'Could not parse token.json',
        fix: 'Run `broski --new-token`',
      })
    }
  }

  if (opts.deep && listening) {
    try {
      const scheme = ctx.config.security.tls ? 'https' : 'http'
      const res = await fetch(`${scheme}://127.0.0.1:${ctx.port}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      results.push({
        id: 'health_endpoint',
        category: 'connectivity',
        status: res.ok ? 'ok' : 'info',
        message: `Bridge /health probe: HTTP ${res.status}`,
      })
    } catch {
      results.push({
        id: 'health_endpoint',
        category: 'connectivity',
        status: 'info',
        message: 'Bridge /health probe unavailable (normal for some modes)',
      })
    }
  }

  return results
}
