/**
 * Session Robustness Tests
 *
 * Tests the multi-session, multi-backend robustness fixes:
 * 1. Permission timeouts (10 minutes, not 2)
 * 2. Event buffering when no owner socket connected
 * 3. Owner rebinding on set_view after reconnect
 * 4. Active sessions push on device registration
 * 5. Dynamic socket lookup in CC stream (not stale captured ws)
 * 6. Session idle broadcast via enqueueSdkEvent
 * 7. Event buffer cleanup on completion/crash/shutdown
 *
 * Split into:
 * - Source invariant tests (verify code patterns without running server)
 * - Live integration tests (spin up real bridge server + WS clients)
 *
 * NOTE: Live tests require BROSKI_TLS=0 env var (server uses self-signed TLS by default).
 * Run: BROSKI_TLS=0 bun test src/__tests__/session_robustness.test.ts
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { createBridgeServer, type BridgeServer, type BridgeServerOptions } from '../server'

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readServerSource(): string {
  const fs = require('node:fs')
  const path = require('node:path')
  const serverSrc = fs.readFileSync(path.resolve(__dirname, '..', 'server.ts'), 'utf-8')
  // Also read extracted handler files so source invariant tests cover them
  const handlerFiles = ['auth.ts', 'cc_chat.ts']
  const handlerSrcs = handlerFiles.map((f: string) => {
    try { return fs.readFileSync(path.resolve(__dirname, '..', 'handlers', f), 'utf-8') } catch { return '' }
  })
  return serverSrc + '\n' + handlerSrcs.join('\n')
}

/** Slice a larger region around a needle to capture all relevant code */
function sliceAround(src: string, needle: string, before = 0, after = 5000): string {
  const idx = src.indexOf(needle)
  if (idx < 0) return ''
  return src.slice(Math.max(0, idx - before), idx + needle.length + after)
}

function makeOptions(overrides?: Partial<BridgeServerOptions>): BridgeServerOptions {
  return {
    port: 0,
    opencode: null,
    version: '0.0.0-test',
    auth: { token: 'test-token-robustness', expiresAt: Date.now() + 86400_000 },
    ...overrides,
  }
}

async function connectWs(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Bridge accepts auth via sec-websocket-protocol: broski-auth.<token>
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`broski-auth.${token}`])
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 5000)
    ws.onopen = () => { clearTimeout(t); resolve(ws) }
    ws.onerror = (e) => { clearTimeout(t); reject(e) }
  })
}

function wsSend(ws: WebSocket, msg: Record<string, unknown>) {
  ws.send(JSON.stringify(msg))
}

function collectMessages(ws: WebSocket) {
  const messages: Array<Record<string, unknown>> = []
  ws.onmessage = (event) => {
    try { messages.push(JSON.parse(String(event.data))) } catch { /* ignore */ }
  }
  return {
    all: () => [...messages],
    clear: () => { messages.length = 0 },
    waitFor: (type: string, timeoutMs = 5000) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const existing = messages.find((m) => m.type === type)
      if (existing) return resolve(existing)
      const t = setTimeout(() => reject(new Error(`Timeout waiting for '${type}' (got: ${messages.map(m => m.type).join(', ')})`)), timeoutMs)
      const prev = ws.onmessage
      ws.onmessage = (event) => {
        if (prev) (prev as any)(event)
        try {
          const data = JSON.parse(String(event.data))
          messages.push(data)
          if (data.type === type) { clearTimeout(t); ws.onmessage = prev; resolve(data) }
        } catch { /* ignore */ }
      }
    }),
  }
}

// ══════════════════════════════════════════════════════════════════════
// PART 1: SOURCE INVARIANT TESTS
// Verify code patterns exist correctly in server.ts without running it.
// These catch regressions if someone reverts or changes the robustness code.
// ══════════════════════════════════════════════════════════════════════

describe('Source Invariants', () => {
  const src = readServerSource()

  describe('Permission Timeouts', () => {
    test('PERMISSION_TIMEOUT_MS is 600_000 (10 minutes)', () => {
      expect(src).toContain('const PERMISSION_TIMEOUT_MS = 600_000')
    })

    test('no hardcoded 120_000 in permission waiter code paths', () => {
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('120_000')) {
          const context = lines.slice(Math.max(0, i - 5), i + 5).join('\n')
          expect(context).not.toContain('ccPermissionWaiters')
          expect(context).not.toContain('cxApprovalWaiters')
        }
      }
    })

    test('CC permission uses PERMISSION_TIMEOUT_MS', () => {
      // The CC permission handler resolves/rejects with PERMISSION_TIMEOUT_MS timeout
      const section = sliceAround(src, 'ccPermissionWaiters.set(key', 200, 50)
      expect(section).toContain('PERMISSION_TIMEOUT_MS')
    })

    test('CX permission uses PERMISSION_TIMEOUT_MS', () => {
      const section = sliceAround(src, 'cxApprovalWaiters.set(key', 200, 50)
      expect(section).toContain('PERMISSION_TIMEOUT_MS')
    })
  })

  describe('Event Buffers', () => {
    test('buffer constants declared', () => {
      expect(src).toContain('const SESSION_EVENT_BUFFER_SIZE = 100')
      expect(src).toContain('const ccEventBuffers = new Map')
      expect(src).toContain('const cxEventBuffers = new Map')
    })

    test('buffer helper functions exist', () => {
      expect(src).toContain('const bufferCcEvent = (sessionId: string, event: any)')
      expect(src).toContain('const bufferCxEvent = (threadId: string, event: any)')
      expect(src).toContain('const replayBufferedEvents = (ws: ServerWebSocket<unknown>')
    })

    test('buffers enforce size cap via splice', () => {
      const ccBuf = sliceAround(src, 'const bufferCcEvent', 0, 300)
      expect(ccBuf).toContain('SESSION_EVENT_BUFFER_SIZE')
      expect(ccBuf).toContain('buf.splice(0')

      const cxBuf = sliceAround(src, 'const bufferCxEvent', 0, 300)
      expect(cxBuf).toContain('SESSION_EVENT_BUFFER_SIZE')
      expect(cxBuf).toContain('buf.splice(0')
    })

    test('replay filters by 60s TTL', () => {
      const replay = sliceAround(src, 'const replayBufferedEvents', 0, 800)
      expect(replay).toContain('60_000')
      expect(replay).toContain('e.ts >= cutoff')
    })

    test('replay clears buffer after send', () => {
      // After replaying, the buffer for that session is deleted
      const replay = sliceAround(src, 'const replayBufferedEvents', 0, 1200)
      expect(replay).toContain('bufferMap.delete(sessionId)')
    })

    test('emitCcStream buffers when no owner (resolvedOwner is null)', () => {
      // The code does: bufferCcEvent(sessionId, streamMsg) inside emitCcStream
      const fn = sliceAround(src, 'const emitCcStream = (', 0, 1500)
      expect(fn).toContain('bufferCcEvent(sessionId, streamMsg)')
    })

    test('emitCxStream buffers when no owner', () => {
      const fn = sliceAround(src, 'const emitCxStream = (', 0, 1200)
      expect(fn).toContain('bufferCxEvent(threadId, streamMsg)')
    })
  })

  describe('Dynamic Socket Lookup in CC Chat', () => {
    // Use a wide window — cc_chat handler extracted to handlers/cc_chat.ts
    const ccChat = sliceAround(src, "export async function handleCcChat(", 0, 14000)

    test('getOwnerSocket defined for dynamic lookup', () => {
      expect(ccChat).toContain('const getOwnerSocket = (sessionId: string)')
      expect(ccChat).toContain('ccSessionOwners.get(sessionId)')
    })

    test('emitCcStream called WITHOUT ws as owner for stream messages', () => {
      // The new pattern: emitCcStream(actualSessionId, streamMsgWithId) — no ws
      expect(ccChat).toContain('emitCcStream(actualSessionId, streamMsgWithId)')
      // The OLD pattern with ws as 3rd arg should be gone:
      expect(ccChat).not.toContain('emitCcStream(actualSessionId, streamMsgWithId, ws)')
    })

    test('sendSessionIdle uses enqueueSdkEvent (broadcast), not send(ws)', () => {
      const idle = sliceAround(ccChat, 'const sendSessionIdle', 0, 800)
      expect(idle).toContain('enqueueSdkEvent')
      expect(idle).not.toContain('send(ws,')
    })

    test('sendSessionBusy uses getOwnerSocket', () => {
      const busy = sliceAround(ccChat, 'const sendSessionBusy', 0, 800)
      expect(busy).toContain('getOwnerSocket(sessionId)')
    })

    test('completion clears ownership AND event buffer', () => {
      expect(ccChat).toContain('ccSessionOwners.delete(sid)')
      expect(ccChat).toContain('ccEventBuffers.delete(sid)')
    })

    test('error handler also clears ownership AND event buffer', () => {
      // Both completion and error handlers clear these, so there should be >= 2 of each
      const ownerDeletes = (ccChat.match(/ccSessionOwners\.delete\(sid\)/g) || []).length
      const bufferDeletes = (ccChat.match(/ccEventBuffers\.delete\(sid\)/g) || []).length
      expect(ownerDeletes).toBeGreaterThanOrEqual(2)
      expect(bufferDeletes).toBeGreaterThanOrEqual(2)
    })

    test('error emitCcStream called without ws', () => {
      // After extraction the pattern is multi-line; check key elements
      expect(ccChat).toContain("emitCcStream(sid, {")
      expect(ccChat).toContain("message: error.message")
      expect(ccChat).toContain("code: 'cc_error'")
    })

    test('permission request routes through emitCcStream', () => {
      // The canUseTool callback builds a permission-request and sends it via emitCcStream.
      // This is deep in the cc_chat handler (~12K chars in), so search the full source.
      const permSection = sliceAround(src, "type: 'permission-request'", 1400, 200)
      expect(permSection).toContain('emitCcStream(sid')
      expect(permSection).toContain("type: 'permission-request'")
    })
  })

  describe('Owner Rebinding on set_view', () => {
    // biome formats with double quotes — match either style
    const setView = sliceAround(src, 'case "set_view":', 0, 5000)
      || sliceAround(src, "case 'set_view':", 0, 5000)

    test('CC active session check + rebind', () => {
      expect(setView).toContain('claudeCode.listActiveSessions()')
      expect(setView).toContain('ccSessionOwners.set(nextSessionId, ws)')
      expect(setView).toContain('replayBufferedEvents(ws,')
    })

    test('CX active turn check + rebind', () => {
      expect(setView).toContain('cxActiveTurns.has(nextSessionId)')
      expect(setView).toContain('cxThreadOwners.set(nextSessionId, ws)')
      expect(setView).toContain('replayBufferedEvents(ws,')
    })

    test('OC rebind', () => {
      expect(setView).toContain('ocSessionOwners.set(nextSessionId, ws)')
    })

    test('stale socket detection via sockets.has()', () => {
      expect(setView).toContain('!sockets.has(prevOwner)')
    })
  })

  describe('Active Sessions Push on Connect', () => {
    const regDevice = sliceAround(src, 'case "register_device":', 0, 6000)
      || sliceAround(src, "case 'register_device':", 0, 6000)

    test('sessions_active message sent after device registration', () => {
      expect(regDevice).toContain('sessions_active')
    })

    test('includes all 3 backends', () => {
      expect(regDevice).toContain('claudeCode: activeCC')
      expect(regDevice).toContain('codex: activeCX')
      expect(regDevice).toContain('opencode: activeOC')
    })

    test('includes pending permissions', () => {
      expect(regDevice).toContain('pendingPermissions')
      expect(regDevice).toContain('pendingCCPerms')
      expect(regDevice).toContain('pendingCXPerms')
    })
  })

  describe('Cleanup on Crash/Shutdown', () => {
    test('CX turn/completed clears event buffer', () => {
      const section = sliceAround(src, 'n.method === "turn/completed"', 0, 300)
        || sliceAround(src, "n.method === 'turn/completed'", 0, 300)
      expect(section).toContain('cxEventBuffers.delete(threadId)')
    })

    test('Codex app-server crash clears event buffers', () => {
      // Need wider window — the cxEventBuffers.clear() is after iterating owners
      const section = sliceAround(src, 'onExit: (code, signal)', 0, 2000)
      expect(section).toContain('cxEventBuffers.clear()')
    })

    test('bridge shutdown clears all event buffers', () => {
      const section = sliceAround(src, 'ccExternalTails.clear()', 0, 300)
      expect(section).toContain('ccEventBuffers.clear()')
      expect(section).toContain('cxEventBuffers.clear()')
    })
  })
})

// ══════════════════════════════════════════════════════════════════════
// PART 2: LIVE INTEGRATION TESTS
// Spin up real bridge server, connect WebSocket clients, verify behavior.
// Require BROSKI_TLS=0 since the server enables self-signed TLS by default.
// ══════════════════════════════════════════════════════════════════════

const tlsDisabled = process.env.BROSKI_TLS === '0'

describe('Live Integration', () => {
  let server: BridgeServer
  let port: number
  let token: string
  const clients: WebSocket[] = []

  afterEach(async () => {
    for (const ws of clients) { try { ws.close() } catch {} }
    clients.length = 0
    if (server) { try { server.stop(true) } catch {} }
    await sleep(100)
  })

  async function setup(overrides?: Partial<BridgeServerOptions>) {
    server = await createBridgeServer(makeOptions(overrides))
    port = server.port()
    token = server.authToken()
  }

  async function connect() {
    const ws = await connectWs(port, token)
    clients.push(ws)
    const msgs = collectMessages(ws)
    return { ws, msgs }
  }

  const liveTest = tlsDisabled ? test : test.skip

  liveTest('client connects and receives status', async () => {
    await setup()
    const { ws, msgs } = await connect()
    const status = await msgs.waitFor('status', 3000)
    expect(status.type).toBe('status')
  })

  liveTest('device registration sends sessions_active', async () => {
    await setup()
    const { ws, msgs } = await connect()

    wsSend(ws, {
      type: 'register_device',
      deviceId: 'test-dev-1',
      deviceName: 'Test Phone',
      platform: 'ios',
    })

    await msgs.waitFor('device_registered', 3000)
    const active = await msgs.waitFor('sessions_active', 3000)
    expect(active.type).toBe('sessions_active')

    const data = active.data as any
    expect(Array.isArray(data.claudeCode)).toBe(true)
    expect(Array.isArray(data.codex)).toBe(true)
    expect(Array.isArray(data.opencode)).toBe(true)
    expect(data.pendingPermissions).toBeDefined()
  })

  liveTest('set_view returns status and does not crash', async () => {
    await setup()
    const { ws, msgs } = await connect()

    wsSend(ws, { type: 'register_device', deviceId: 'sv-test', deviceName: 'T', platform: 'ios' })
    await msgs.waitFor('device_registered')
    msgs.clear()

    wsSend(ws, { type: 'set_view', agent: 'claude-code', sessionId: 'cc-123', projectPath: '/tmp/p' })
    const s = await msgs.waitFor('status', 3000)
    expect(s.type).toBe('status')
  })

  liveTest('rapid backend switching does not crash', async () => {
    await setup()
    const { ws, msgs } = await connect()

    wsSend(ws, { type: 'register_device', deviceId: 'switch-test', deviceName: 'T', platform: 'ios' })
    await msgs.waitFor('device_registered')

    for (let i = 0; i < 20; i++) {
      const agents = ['claude-code', 'opencode', 'codex']
      wsSend(ws, { type: 'set_view', agent: agents[i % 3], sessionId: `s-${i}`, projectPath: '/tmp/p' })
    }
    await sleep(200)

    wsSend(ws, { type: 'get_agents_status', requestId: 'alive-check' })
    const resp = await msgs.waitFor('agents_status', 3000)
    expect(resp.type).toBe('agents_status')
  })

  liveTest('two clients can coexist', async () => {
    await setup()
    const c1 = await connect()
    const c2 = await connect()

    wsSend(c1.ws, { type: 'register_device', deviceId: 'p1', deviceName: 'Phone1', platform: 'ios' })
    wsSend(c2.ws, { type: 'register_device', deviceId: 'p2', deviceName: 'Phone2', platform: 'android' })

    await c1.msgs.waitFor('device_registered')
    await c2.msgs.waitFor('device_registered')

    expect(server.connections()).toBe(2)
  })

  liveTest('client disconnect + reconnect works cleanly', async () => {
    await setup()

    const c1 = await connect()
    wsSend(c1.ws, { type: 'register_device', deviceId: 'reconnect', deviceName: 'T', platform: 'ios' })
    await c1.msgs.waitFor('device_registered')

    wsSend(c1.ws, { type: 'set_view', agent: 'claude-code', sessionId: 'cc-recon', projectPath: '/tmp/p' })
    await sleep(100)
    c1.ws.close()
    await sleep(200)

    // Reconnect
    const c2 = await connect()
    wsSend(c2.ws, { type: 'register_device', deviceId: 'reconnect', deviceName: 'T', platform: 'ios' })
    const reg = await c2.msgs.waitFor('device_registered')
    expect(reg.type).toBe('device_registered')

    const active = await c2.msgs.waitFor('sessions_active', 3000)
    expect(active.type).toBe('sessions_active')
  })

  liveTest('rapid connect/disconnect cycles', async () => {
    await setup()

    for (let i = 0; i < 5; i++) {
      const c = await connect()
      wsSend(c.ws, { type: 'register_device', deviceId: `rapid-${i}`, deviceName: 'R', platform: 'ios' })
      await sleep(50)
      c.ws.close()
      await sleep(50)
    }

    // Server still healthy
    const c = await connect()
    wsSend(c.ws, { type: 'get_agents_status', requestId: 'final' })
    const resp = await c.msgs.waitFor('agents_status', 3000)
    expect(resp.type).toBe('agents_status')
  })

  liveTest('get_agents_status returns all 3 backends', async () => {
    await setup()
    const { ws, msgs } = await connect()

    wsSend(ws, { type: 'get_agents_status', requestId: 'check' })
    const resp = await msgs.waitFor('agents_status', 3000)
    const data = resp.data as any
    expect(data).toHaveProperty('opencode')
    expect(data).toHaveProperty('claude-code')
    expect(data).toHaveProperty('codex')
  })

  liveTest('set_agent for all backends does not crash', async () => {
    await setup()
    const { ws, msgs } = await connect()

    for (const agent of ['opencode', 'claude-code', 'codex']) {
      wsSend(ws, { type: 'set_agent', agent })
      await sleep(100)
    }

    wsSend(ws, { type: 'get_agents_status', requestId: 'post' })
    const resp = await msgs.waitFor('agents_status', 3000)
    expect(resp.type).toBe('agents_status')
  })
})
