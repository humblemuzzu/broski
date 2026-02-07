/**
 * Smoke tests for binary integrity verification.
 * Run: cd packages/bridge && bun test src/license/integrity.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { verifyBinaryIntegrity, startPeriodicIntegrityCheck, stopPeriodicIntegrityCheck } from './integrity'

// In dev mode (not compiled binary), all checks should be skipped/pass
describe('integrity — dev mode', () => {
  test('verifyBinaryIntegrity returns ok + all skipped in dev mode', () => {
    const result = verifyBinaryIntegrity()
    expect(result.ok).toBe(true)
    expect(result.checks.codesign.skipped).toBe(true)
    expect(result.checks.sentinel.skipped).toBe(true)
    expect(result.checks.signedHash.skipped).toBe(true)
    expect(result.checks.nativeSidecar.skipped).toBe(true)
  })

  test('startPeriodicIntegrityCheck is a no-op in dev mode', () => {
    // Should not throw or start any timers
    let called = false
    startPeriodicIntegrityCheck(() => { called = true })
    // Give it a tick
    expect(called).toBe(false)
    stopPeriodicIntegrityCheck()
  })
})

// Sentinel computation should be deterministic
describe('sentinel', () => {
  test('computeSecuritySentinel returns consistent hash', async () => {
    const { computeSecuritySentinel } = await import('./integrity')
    const hash1 = computeSecuritySentinel()
    const hash2 = computeSecuritySentinel()
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex = 64 chars
  })

  test('sentinel matches expected chunks', async () => {
    const { computeSecuritySentinel } = await import('./integrity')
    const computed = computeSecuritySentinel()
    const expected = [
      '93a78f3497cafdef',
      '89b94fcacfbc855d',
      'f0c39452c5637760',
      '3846ef29c04922b2',
    ].join('')
    expect(computed).toBe(expected)
  })
})

// License module re-exports
describe('license index exports', () => {
  test('integrity functions are exported from license/index', async () => {
    const license = await import('./index')
    expect(typeof license.verifyBinaryIntegrity).toBe('function')
    expect(typeof license.startPeriodicIntegrityCheck).toBe('function')
    expect(typeof license.stopPeriodicIntegrityCheck).toBe('function')
  })

  test('existing license functions still work', async () => {
    const license = await import('./index')
    expect(typeof license.getLicenseCrypto).toBe('function')
    expect(typeof license.loadLocalLicenseState).toBe('function')
    expect(typeof license.refreshLocalLicenseFromCloud).toBe('function')
  })
})

// Server.ts defense-in-depth — verify isCompiledBinary returns false in dev
describe('platform check', () => {
  test('isCompiledBinary returns false in dev/test', async () => {
    const { isCompiledBinary } = await import('../platform')
    expect(isCompiledBinary()).toBe(false)
  })
})
