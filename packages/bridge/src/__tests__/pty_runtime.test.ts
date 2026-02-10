import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PtyRuntime } from '../pty/runtime'
import type { PtySession, ServerMessage } from '../types'

function makeSession(id: string): PtySession {
  return {
    id,
    title: `Terminal ${id}`,
    command: '/bin/zsh',
    args: [],
    cwd: '/repo',
    status: 'running',
    pid: 500,
  }
}

class FakeUpstreamWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeUpstreamWebSocket[] = []

  readonly url: string
  readyState = FakeUpstreamWebSocket.CONNECTING
  sent: string[] = []

  private listeners = new Map<string, Array<(event: any) => void>>()

  constructor(url: string) {
    this.url = url
    FakeUpstreamWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  close(code = 1000): void {
    if (this.readyState === FakeUpstreamWebSocket.CLOSED) return
    this.readyState = FakeUpstreamWebSocket.CLOSED
    this.emit('close', { code })
  }

  emitOpen(): void {
    this.readyState = FakeUpstreamWebSocket.OPEN
    this.emit('open', {})
  }

  emitMessage(data: string): void {
    this.emit('message', { data })
  }

  emitError(): void {
    this.emit('error', {})
  }

  private emit(type: string, event: any): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event)
    }
  }
}

describe('PtyRuntime', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    FakeUpstreamWebSocket.instances = []
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  test('OpenCode path keeps smooth output buffering and bidirectional I/O', async () => {
    globalThis.WebSocket = FakeUpstreamWebSocket as any

    const sentMessages: Array<{ ws: any; message: ServerMessage }> = []
    const replies: ServerMessage[] = []

    const manager = {
      backend: 'opencode' as const,
      available: true,
      getWebSocketUrl: () => 'ws://127.0.0.1:4096/pty/p1/connect',
      connectNative: () => null,
      stop: async () => {},
      listPty: async () => [],
      createPty: async () => null,
      getPty: async () => null,
      updatePty: async () => null,
      deletePty: async () => true,
      resize: async () => {},
    }

    const runtime = new PtyRuntime({
      ptyManager: manager as any,
      send: (ws, message) => sentMessages.push({ ws, message }),
      log: () => {},
      resolveSecurePath: async (path) => path,
    })

    const wsA = { id: 'A' } as any

    await runtime.handleMessage(wsA, { type: 'pty_connect', ptyId: 'p1' } as any, (m) => replies.push(m))

    expect(FakeUpstreamWebSocket.instances.length).toBe(1)
    const upstream = FakeUpstreamWebSocket.instances[0]
    upstream.emitOpen()

    expect(replies.some((m) => m.type === 'pty_connected')).toBe(true)

    // Fast consecutive chunks should be coalesced into one output frame (~16ms flush).
    upstream.emitMessage('hel')
    upstream.emitMessage('lo')
    await Bun.sleep(30)

    const outputs = sentMessages.filter((m) => m.message.type === 'pty_output' && (m.message as any).ptyId === 'p1')
    expect(outputs.length).toBe(1)
    expect((outputs[0].message as any).data).toBe('hello')

    const hugeBurst = 'x'.repeat(600 * 1024)
    upstream.emitMessage(hugeBurst)
    await Bun.sleep(40)
    const truncationProtected = sentMessages
      .filter((m) => m.message.type === 'pty_output' && (m.message as any).ptyId === 'p1')
      .some((m) => String((m.message as any).data).includes('[broski] terminal output truncated'))
    expect(truncationProtected).toBe(true)

    await runtime.handleMessage(wsA, { type: 'pty_input', ptyId: 'p1', data: 'ls\n' } as any, (m) => replies.push(m))
    expect(upstream.sent.includes('ls\n')).toBe(true)

    await runtime.handleMessage(wsA, { type: 'pty_disconnect', ptyId: 'p1' } as any, (m) => replies.push(m))
    expect(replies.some((m) => m.type === 'pty_disconnected')).toBe(true)
    expect(upstream.readyState).toBe(FakeUpstreamWebSocket.CLOSED)

    await runtime.stop()
  })

  test('native path supports input/output, errors, health, and exit events', async () => {
    const sentMessages: Array<{ ws: any; message: ServerMessage }> = []
    const replies: ServerMessage[] = []

    let onData: ((data: string) => void) | null = null
    let onExit: ((code?: number) => void) | null = null
    const writes: string[] = []

    const nativeConn = {
      onData: (cb: (data: string) => void) => {
        onData = cb
      },
      onExit: (cb: (code?: number) => void) => {
        onExit = cb
      },
      write: (data: string) => {
        writes.push(data)
      },
      resize: () => {},
      disconnect: () => {},
    }

    let resizeCall: any[] | null = null

    const manager = {
      backend: 'native' as const,
      available: true,
      getWebSocketUrl: () => null,
      connectNative: () => nativeConn,
      stop: async () => {},
      listPty: async () => [makeSession('n1')],
      createPty: async () => makeSession('n1'),
      getPty: async () => makeSession('n1'),
      updatePty: async (_id: string, title?: string) => ({ ...makeSession('n1'), title: title ?? 't' }),
      deletePty: async () => true,
      resize: async (...args: any[]) => {
        resizeCall = args
      },
    }

    const runtime = new PtyRuntime({
      ptyManager: manager as any,
      send: (ws, message) => sentMessages.push({ ws, message }),
      log: () => {},
      resolveSecurePath: async (path) => path,
    })

    const wsA = { id: 'A' } as any

    await runtime.handleMessage(wsA, { type: 'pty_connect', ptyId: 'n1' } as any, (m) => replies.push(m))
    expect(replies.some((m) => m.type === 'pty_connected')).toBe(true)

    onData?.('foo')
    onData?.('bar')
    await Bun.sleep(30)
    const output = sentMessages.find((m) => m.message.type === 'pty_output')
    expect(output).toBeTruthy()
    expect((output!.message as any).data).toBe('foobar')

    await runtime.handleMessage(wsA, { type: 'pty_input', ptyId: 'n1', data: 'pwd\n' } as any, (m) => replies.push(m))
    expect(writes).toEqual(['pwd\n'])

    await runtime.handleMessage(
      wsA,
      { type: 'pty_input', ptyId: 'n1', data: 'x'.repeat(10_001) } as any,
      (m) => replies.push(m),
    )
    const sizeError = sentMessages.find((m) => m.message.type === 'pty_error')
    expect(sizeError).toBeTruthy()
    expect((sizeError!.message as any).error).toContain('max 10KB')

    await runtime.handleMessage(wsA, { type: 'pty_resize', ptyId: 'n1', rows: 45, cols: 160 } as any, (m) => replies.push(m))
    expect(resizeCall).toEqual(['n1', 45, 160, undefined])

    // Health snapshot cadence and stats
    await Bun.sleep(1100)
    const health = sentMessages.find((m) => m.message.type === 'pty_health')
    expect(health).toBeTruthy()
    expect((health!.message as any).bytesIn).toBeGreaterThan(0)
    expect((health!.message as any).bytesOut).toBeGreaterThan(0)

    onExit?.(0)
    await Bun.sleep(10)
    const exit = sentMessages.find((m) => m.message.type === 'pty_exit')
    expect(exit).toBeTruthy()
    expect((exit!.message as any).exitCode).toBe(0)

    await runtime.stop()
  })

  test('native create validates secure cwd and forwards CRUD replies', async () => {
    const replies: ServerMessage[] = []

    const manager = {
      backend: 'native' as const,
      available: true,
      getWebSocketUrl: () => null,
      connectNative: () => null,
      stop: async () => {},
      listPty: async () => [makeSession('n1')],
      createPty: async () => makeSession('n1'),
      getPty: async () => makeSession('n1'),
      updatePty: async () => makeSession('n1'),
      deletePty: async () => true,
      resize: async () => {},
    }

    let secureCalls = 0
    const runtime = new PtyRuntime({
      ptyManager: manager as any,
      send: () => {},
      log: () => {},
      resolveSecurePath: async (path) => {
        secureCalls += 1
        return path === '/allowed' ? '/allowed' : null
      },
    })

    const ws = {} as any

    await runtime.handleMessage(ws, { type: 'create_pty', cwd: '/denied' } as any, (m) => replies.push(m))
    expect(replies.at(-1)?.type).toBe('error')

    await runtime.handleMessage(ws, { type: 'list_pty' } as any, (m) => replies.push(m))
    await runtime.handleMessage(ws, { type: 'create_pty', cwd: '/allowed' } as any, (m) => replies.push(m))
    await runtime.handleMessage(ws, { type: 'get_pty', ptyId: 'n1' } as any, (m) => replies.push(m))
    await runtime.handleMessage(ws, { type: 'update_pty', ptyId: 'n1', title: 'renamed' } as any, (m) => replies.push(m))
    await runtime.handleMessage(ws, { type: 'delete_pty', ptyId: 'n1' } as any, (m) => replies.push(m))

    expect(secureCalls).toBeGreaterThan(0)
    expect(replies.some((m) => m.type === 'pty_list')).toBe(true)
    expect(replies.some((m) => m.type === 'pty_created')).toBe(true)
    expect(replies.some((m) => m.type === 'pty')).toBe(true)
    expect(replies.some((m) => m.type === 'pty_updated')).toBe(true)
    expect(replies.some((m) => m.type === 'pty_deleted')).toBe(true)

    await runtime.stop()
  })
})
