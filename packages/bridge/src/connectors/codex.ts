import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

export type JsonRpcId = string | number

export type JsonRpcRequest = {
  method: string
  id: JsonRpcId
  params?: unknown
}

export type JsonRpcNotification = {
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  id: JsonRpcId
  result?: unknown
  error?: unknown
}

export type CodexServerRequest = {
  id: JsonRpcId
  method: string
  params?: unknown
}

export type CodexNotification = {
  method: string
  params?: unknown
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: Timer
}

export type CodexAppServerOptions = {
  codexPath?: string
  clientInfo?: { name: string; title: string; version: string }
  onNotification?: (n: CodexNotification) => void
  onServerRequest?: (r: CodexServerRequest) => Promise<unknown>
}

export class CodexAppServerClient {
  private codexPath: string
  private clientInfo: { name: string; title: string; version: string }
  private child: ChildProcessWithoutNullStreams | null = null
  private rl: readline.Interface | null = null
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private onNotification?: (n: CodexNotification) => void
  private onServerRequest?: (r: CodexServerRequest) => Promise<unknown>
  private started = false

  constructor(options: CodexAppServerOptions = {}) {
    this.codexPath = options.codexPath ?? 'codex'
    this.clientInfo = options.clientInfo ?? {
      name: 'broski',
      title: 'Broski',
      version: '0.1.0',
    }
    this.onNotification = options.onNotification
    this.onServerRequest = options.onServerRequest
  }

  setHandlers(options: Pick<CodexAppServerOptions, 'onNotification' | 'onServerRequest'>) {
    this.onNotification = options.onNotification
    this.onServerRequest = options.onServerRequest
  }

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.started && this.isRunning) {
      console.log('[Codex] Already started and running, skipping')
      return
    }
    console.log('[Codex] Starting app-server...')
    await this.stop()

    this.child = spawn(this.codexPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })

    this.child.on('exit', (code) => {
      console.log(`[Codex] app-server exited with code: ${code}`)
      this.started = false
      this._rejectAllPending(new Error('Codex app-server exited'))
    })

    this.child.on('error', (err) => {
      console.error(`[Codex] app-server spawn error:`, err)
    })

    // Log stderr for debugging
    this.child.stderr?.on('data', (data) => {
      console.error(`[Codex stderr] ${data.toString()}`)
    })

    if (!this.child.stdin || !this.child.stdout) {
      throw new Error('Failed to start codex app-server (missing stdio)')
    }

    this.rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })

    void this._pump()

    // Initialize handshake: initialize request then initialized notification.
    console.log('[Codex] Sending initialize request...')
    await this.request('initialize', {
      clientInfo: this.clientInfo,
    })
    console.log('[Codex] Sending initialized notification...')
    this.notify('initialized')
    this.started = true
    console.log('[Codex] app-server started successfully')
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.rl) {
      try {
        this.rl.close()
      } catch {
        // ignore
      }
      this.rl = null
    }

    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
      this.child = null
    }
    this._rejectAllPending(new Error('Codex app-server stopped'))
  }

  notify(method: string, params?: unknown): void {
    this._write({ method, ...(params !== undefined ? { params } : {}) })
  }

  async request(method: string, params?: unknown, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++
    const key = String(id)
    console.log(`[Codex] Request ${id}: ${method}`)
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.log(`[Codex] Request ${id} timed out: ${method}`)
        this.pending.delete(key)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(key, { resolve, reject, timer })
      this._write({ method, id, ...(params !== undefined ? { params } : {}) })
    })
  }

  private _write(payload: Record<string, unknown>) {
    if (!this.child?.stdin) {
      throw new Error('Codex app-server not running')
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private async _pump(): Promise<void> {
    const rl = this.rl
    if (!rl) return

    for await (const line of rl) {
      const trimmed = String(line ?? '').trim()
      if (!trimmed) continue

      let msg: any
      try {
        msg = JSON.parse(trimmed)
      } catch {
        // Ignore non-JSON lines (should be rare; app-server mostly speaks JSONL).
        continue
      }

      // Response to our request
      if (msg && typeof msg === 'object' && 'id' in msg && ('result' in msg || 'error' in msg)) {
        const key = String(msg.id)
        const pending = this.pending.get(key)
        console.log(`[Codex] Response ${key}: ${msg.error ? 'error' : 'success'}`)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(key)
          if (msg.error) {
            console.error(`[Codex] Error response:`, msg.error)
            pending.reject(new Error(`Codex app-server error: ${JSON.stringify(msg.error)}`))
          } else {
            pending.resolve(msg.result)
          }
        } else {
          console.log(`[Codex] No pending request for id ${key}`)
        }
        continue
      }

      // Server-initiated request (expects a response)
      if (msg && typeof msg === 'object' && 'id' in msg && typeof msg.method === 'string') {
        const req: CodexServerRequest = {
          id: msg.id as JsonRpcId,
          method: msg.method as string,
          params: msg.params,
        }

        const handler = this.onServerRequest
        if (!handler) {
          this._write({
            id: req.id,
            error: { message: 'No handler for server request' },
          })
          continue
        }

        try {
          const result = await handler(req)
          this._write({ id: req.id, result })
        } catch (err: any) {
          this._write({
            id: req.id,
            error: { message: err?.message ?? String(err) },
          })
        }
        continue
      }

      // Notification
      if (msg && typeof msg === 'object' && typeof msg.method === 'string' && !('id' in msg)) {
        this.onNotification?.({ method: msg.method as string, params: msg.params })
      }
    }
  }

  private _rejectAllPending(err: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }
}

export async function checkCodexAvailable(codexPath = 'codex'): Promise<boolean> {
  try {
    const child = spawn(codexPath, ['--help'], { stdio: 'ignore' })
    const ok = await new Promise<boolean>((resolve) => {
      child.once('error', () => resolve(false))
      child.once('exit', (code) => resolve(code === 0))
    })
    return ok
  } catch {
    return false
  }
}

