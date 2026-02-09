import { describe, test, expect } from 'bun:test'
import { PtyManager } from '../pty/manager'
import type { PtySession } from '../types'

function makeSession(id: string): PtySession {
  return {
    id,
    title: `Terminal ${id}`,
    command: '/bin/zsh',
    args: [],
    cwd: '/tmp',
    status: 'running',
    pid: 123,
  }
}

describe('PtyManager (OpenCode routing)', () => {
  test('routes PTY operations to OpenCode when connector is present', async () => {
    const calls: Array<{ method: string; args: any[] }> = []
    const listResult = [makeSession('oc-1')]
    const created = makeSession('oc-created')
    const updated = makeSession('oc-updated')

    const fakeOc = {
      listPty: async (projectPath?: string) => {
        calls.push({ method: 'listPty', args: [projectPath] })
        return listResult
      },
      createPty: async (...args: any[]) => {
        calls.push({ method: 'createPty', args })
        return created
      },
      getPty: async (...args: any[]) => {
        calls.push({ method: 'getPty', args })
        return created
      },
      updatePty: async (...args: any[]) => {
        calls.push({ method: 'updatePty', args })
        return updated
      },
      deletePty: async (...args: any[]) => {
        calls.push({ method: 'deletePty', args })
        return true
      },
      getPtyWebSocketUrl: (ptyId: string, projectPath?: string) => {
        calls.push({ method: 'getPtyWebSocketUrl', args: [ptyId, projectPath] })
        return `ws://127.0.0.1/pty/${ptyId}?project=${projectPath ?? ''}`
      },
    }

    const manager = new PtyManager(fakeOc as any)

    expect(manager.backend).toBe('opencode')
    expect(manager.available).toBe(true)

    await expect(manager.listPty('/repo')).resolves.toEqual(listResult)
    await expect(
      manager.createPty({
        command: 'bash',
        args: ['-l'],
        cwd: '/repo',
        title: 'shell',
        env: { TERM: 'xterm-256color' },
        projectPath: '/repo',
      }),
    ).resolves.toEqual(created)
    await expect(manager.getPty('oc-created', '/repo')).resolves.toEqual(created)
    await expect(manager.updatePty('oc-created', 'renamed', 30, 120, '/repo')).resolves.toEqual(updated)
    await expect(manager.deletePty('oc-created', '/repo')).resolves.toBe(true)

    await manager.resize('oc-created', 40, 140, '/repo')
    expect(manager.getWebSocketUrl('oc-created', '/repo')).toContain('oc-created')
    expect(manager.connectNative('oc-created')).toBeNull()

    expect(calls.map((c) => c.method)).toContain('listPty')
    expect(calls.map((c) => c.method)).toContain('createPty')
    expect(calls.map((c) => c.method)).toContain('getPty')
    expect(calls.map((c) => c.method)).toContain('updatePty')
    expect(calls.map((c) => c.method)).toContain('deletePty')
    expect(calls.map((c) => c.method)).toContain('getPtyWebSocketUrl')

    const resizeCall = calls.find((c) => c.method === 'updatePty' && c.args[0] === 'oc-created' && c.args[1] === undefined)
    expect(!!resizeCall).toBe(true)
    expect(resizeCall?.args[2]).toBe(40)
    expect(resizeCall?.args[3]).toBe(140)
  })

  test('can switch backend source at runtime', () => {
    const manager = new PtyManager({ listPty: async () => [] } as any)
    expect(manager.backend).toBe('opencode')

    manager.updateOpenCode(null)
    expect(manager.backend).toBe('native')
  })
})
