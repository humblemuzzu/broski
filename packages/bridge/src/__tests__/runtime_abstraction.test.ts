import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mapClaudeCodeStreamToRuntimeEvent } from '../runtime/claude-code-runtime-event-mapper'
import { buildClaudeCodeRuntimeState } from '../runtime/claude-code-runtime-read-models'
import { mapCodexStreamToRuntimeEvent } from '../runtime/codex-runtime-event-mapper'
import { buildCodexRuntimeState } from '../runtime/codex-runtime-read-models'
import { mapOpenCodeSdkEventToRuntimeEvent } from '../runtime/opencode-runtime-event-mapper'

function readServerSource(): string {
  return readFileSync(resolve(import.meta.dir, '..', 'server.ts'), 'utf-8')
}

describe('Runtime Abstraction', () => {
  test('Claude mapper emits common runtime events', () => {
    const started = mapClaudeCodeStreamToRuntimeEvent(
      { type: 'session-created', sessionId: 'cc-1', agent: 'claude-code', model: 'sonnet' },
      { backend: 'claude-code', cwd: '/tmp/repo' },
    )
    expect(started?.type).toBe('agent_started')
    expect(started?.sessionId).toBe('cc-1')

    const permission = mapClaudeCodeStreamToRuntimeEvent(
      {
        type: 'permission-request',
        sessionId: 'cc-1',
        toolUseId: 'tool-1',
        tool: 'Bash',
        input: { command: 'ls' },
        description: 'Allow Bash?',
      },
      { backend: 'claude-code', cwd: '/tmp/repo' },
    )
    expect(permission?.type).toBe('permission_requested')

    const finished = mapClaudeCodeStreamToRuntimeEvent(
      { type: 'result-complete', stopReason: 'end_turn' },
      { backend: 'claude-code', sessionId: 'cc-1', cwd: '/tmp/repo' },
    )
    expect(finished?.type).toBe('agent_finished')
  })

  test('Codex mapper emits common runtime events', () => {
    const started = mapCodexStreamToRuntimeEvent(
      { type: 'notification', method: 'turn/started', params: { turn: { id: 'turn-1' } } },
      { backend: 'codex', threadId: 'cx-1', cwd: '/tmp/repo' },
    )
    expect(started?.type).toBe('agent_started')

    const permission = mapCodexStreamToRuntimeEvent(
      {
        type: 'request',
        requestId: 'req-1',
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'item-1', command: 'rm -rf build' },
      },
      { backend: 'codex', threadId: 'cx-1', cwd: '/tmp/repo' },
    )
    expect(permission?.type).toBe('permission_requested')

    const tool = mapCodexStreamToRuntimeEvent(
      {
        type: 'notification',
        method: 'item/completed',
        params: {
          item: {
            id: 'item-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'ls',
            aggregatedOutput: 'file.txt',
          },
        },
      },
      { backend: 'codex', threadId: 'cx-1', cwd: '/tmp/repo' },
    )
    expect(tool?.type).toBe('tool_finished')
  })

  test('OpenCode mapper emits common runtime events', () => {
    const status = mapOpenCodeSdkEventToRuntimeEvent({
      directory: '/tmp/repo',
      payload: {
        type: 'session.status',
        properties: { sessionID: 'oc-1', status: { type: 'busy' } },
      },
    })
    expect(status?.type).toBe('session_state_changed')

    const delta = mapOpenCodeSdkEventToRuntimeEvent({
      directory: '/tmp/repo',
      payload: {
        type: 'message.part.delta',
        properties: {
          sessionID: 'oc-1',
          messageID: 'msg-1',
          partID: 'part-1',
          field: 'text',
          delta: 'hello',
        },
      },
    })
    expect(delta?.type).toBe('assistant_text_delta')
  })

  test('runtime state builders mark Claude and Codex streaming state honestly', () => {
    const ccState = buildClaudeCodeRuntimeState({
      sessionId: 'cc-1',
      cwd: '/tmp/repo',
      isStreaming: true,
      model: 'sonnet',
    })
    expect(ccState.backend).toBe('claude-code')
    expect(ccState.isStreaming).toBeTrue()

    const cxState = buildCodexRuntimeState({
      threadId: 'cx-1',
      cwd: '/tmp/repo',
      isStreaming: false,
    })
    expect(cxState.backend).toBe('codex')
    expect(cxState.isStreaming).toBeFalse()
  })

  test('server emits runtime_state snapshots for Claude and Codex reconnect paths', () => {
    const src = readServerSource()
    expect(src).toContain("backend: 'claude-code'")
    expect(src).toContain('buildClaudeCodeRuntimeState({')
    expect(src).toContain("backend: 'codex'")
    expect(src).toContain('buildCodexRuntimeState({')
    expect(src).toContain("type: 'runtime_state'")
  })
})
