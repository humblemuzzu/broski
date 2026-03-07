import type { CodexStreamMessage } from '../types'
import type { BroskiBackendData, BroskiRuntimeEvent } from '../types/runtime'

type CodexRuntimeEventContext = {
  backend: 'codex'
  threadId?: string
  cwd?: string
}

const baseEvent = <TType extends BroskiRuntimeEvent['type']>(
  type: TType,
  ctx: CodexRuntimeEventContext,
  backendData?: BroskiBackendData,
) => ({
  type,
  backend: ctx.backend,
  timestampMs: Date.now(),
  ...(ctx.threadId ? { sessionId: ctx.threadId } : {}),
  ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
  ...(backendData ? { backendData } : {}),
})

function pickToolCallId(item: any): string | undefined {
  const value = item?.callId ?? item?.callID ?? item?.call_id ?? item?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pickToolName(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  const itemType = typeof item.type === 'string' ? item.type : ''
  if (typeof item.tool === 'string' && item.tool.length > 0) return item.tool
  if (typeof item.name === 'string' && item.name.length > 0) return item.name
  switch (itemType) {
    case 'commandExecution':
      return 'Bash'
    case 'fileChange':
      return 'ApplyPatch'
    case 'mcpToolCall':
      return `${String(item.server ?? '')}.${String(item.tool ?? '')}`.replace(/^\./, '')
    case 'webSearch':
      return 'WebSearch'
    case 'review':
      return 'Review'
    default:
      return itemType || undefined
  }
}

function isCodexToolItem(item: any): boolean {
  const itemType = typeof item?.type === 'string' ? item.type : ''
  return itemType === 'commandExecution' ||
    itemType === 'fileChange' ||
    itemType === 'mcpToolCall' ||
    itemType === 'webSearch' ||
    itemType === 'review'
}

function parseMaybeJson(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const trimmed = input.trim()
  if (!trimmed) return input
  try {
    return JSON.parse(trimmed)
  } catch {
    return input
  }
}

export function mapCodexStreamToRuntimeEvent(
  streamMessage: CodexStreamMessage,
  ctx: CodexRuntimeEventContext,
): BroskiRuntimeEvent | null {
  switch (streamMessage.type) {
    case 'error':
      return {
        ...baseEvent('error', ctx, {
          sourceType: streamMessage.type,
          ...(streamMessage.details !== undefined
              ? { details: streamMessage.details }
              : {}),
          ...(streamMessage.modelCapModel
              ? { modelCapModel: streamMessage.modelCapModel }
              : {}),
          ...(streamMessage.modelCapRetrySeconds !== undefined
              ? { modelCapRetrySeconds: streamMessage.modelCapRetrySeconds }
              : {}),
        }),
        message: streamMessage.message,
        ...(streamMessage.code ? { code: streamMessage.code } : {}),
      }

    case 'request': {
      if (streamMessage.method === 'item/tool/requestUserInput') {
        const params = streamMessage.params ?? {}
        return {
          ...baseEvent('user_input_requested', ctx, {
            sourceType: streamMessage.type,
            method: streamMessage.method,
          }),
          request: {
            requestId: streamMessage.requestId,
            kind: 'tool_input',
            title: typeof params.title === 'string' ? params.title : 'Input required',
            prompt:
              typeof params.prompt === 'string'
                ? params.prompt
                : typeof params.message === 'string'
                  ? params.message
                  : undefined,
            placeholder:
              typeof params.placeholder === 'string' ? params.placeholder : undefined,
            options: Array.isArray(params.options)
              ? params.options.map((value: unknown) => String(value))
              : undefined,
            metadata: params,
          },
        }
      }

      if (streamMessage.method.includes('requestApproval')) {
        const params = streamMessage.params ?? {}
        return {
          ...baseEvent('permission_requested', ctx, {
            sourceType: streamMessage.type,
            method: streamMessage.method,
          }),
          ...(typeof params.itemId === 'string' ? { toolCallId: params.itemId } : {}),
          request: {
            requestId: streamMessage.requestId,
            kind: streamMessage.method,
            title:
              typeof params.reason === 'string' && params.reason.length > 0
                ? params.reason
                : 'Approval required',
            message:
              typeof params.command === 'string'
                ? params.command
                : typeof params.skillName === 'string'
                  ? params.skillName
                  : undefined,
            metadata: params,
          },
        }
      }

      return null
    }

    case 'notification': {
      const params = streamMessage.params ?? {}

      switch (streamMessage.method) {
        case 'turn/started':
          return {
            ...baseEvent('agent_started', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
              turnId: params.turnId ?? params.turn?.id,
            }),
          }

        case 'turn/completed':
          return {
            ...baseEvent('agent_finished', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
              turnId: params.turnId ?? params.turn?.id,
              status: params.turn?.status,
            }),
            ...(typeof params.turn?.status === 'string'
                ? { stopReason: params.turn.status }
                : {}),
          }

        case 'thread/compacted':
          return {
            ...baseEvent('compaction_finished', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
              params,
            }),
          }

        case 'item/started':
        case 'item/completed': {
          const item = params.item
          if (!isCodexToolItem(item)) return null

          const eventType = streamMessage.method === 'item/started'
            ? 'tool_started'
            : 'tool_finished'
          const base = baseEvent(eventType, ctx, {
            sourceType: streamMessage.type,
            method: streamMessage.method,
            itemType: item.type,
            status: item.status,
          })
          const toolCallId = pickToolCallId(item)
          const toolName = pickToolName(item)
          const input = item?.input ?? item?.arguments ?? {
            ...(item?.command ? { command: item.command } : {}),
            ...(item?.cwd ? { cwd: item.cwd } : {}),
            ...(item?.changes ? { changes: item.changes } : {}),
            ...(item?.query ? { query: item.query } : {}),
          }

          if (eventType === 'tool_started') {
            return {
              ...base,
              ...(toolCallId ? { toolCallId } : {}),
              ...(toolName ? { toolName } : {}),
              input,
            }
          }

          const output = item?.result ?? item?.output ?? item?.aggregatedOutput ?? item?.error
          return {
            ...base,
            ...(toolCallId ? { toolCallId } : {}),
            ...(toolName ? { toolName } : {}),
            input,
            output,
            isError: item?.status === 'failed' || item?.status === 'declined',
          }
        }

        case 'item/commandExecution/outputDelta': {
          const itemId = typeof params.itemId === 'string'
            ? params.itemId
            : typeof params.item_id === 'string'
              ? params.item_id
              : undefined
          if (!itemId || typeof params.delta !== 'string' || !params.delta) {
            return null
          }

          return {
            ...baseEvent('tool_updated', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
            }),
            toolCallId: itemId,
            toolName: 'Bash',
            partialOutput: params.delta,
          }
        }

        case 'rawResponseItem/completed': {
          const item = params.item
          const itemType = typeof item?.type === 'string' ? item.type : ''
          if (
            itemType !== 'function_call' &&
            itemType !== 'function_call_output' &&
            itemType !== 'custom_tool_call' &&
            itemType !== 'custom_tool_call_output'
          ) {
            return null
          }

          const toolCallId = pickToolCallId(item)
          if (!toolCallId) return null

          if (itemType === 'function_call' || itemType === 'custom_tool_call') {
            return {
              ...baseEvent('tool_started', ctx, {
                sourceType: streamMessage.type,
                method: streamMessage.method,
                itemType,
              }),
              toolCallId,
              ...(pickToolName(item) ? { toolName: pickToolName(item) } : {}),
              input: parseMaybeJson(item?.arguments ?? item?.input),
            }
          }

          return {
            ...baseEvent('tool_finished', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
              itemType,
            }),
            toolCallId,
            output: item?.output,
          }
        }

        case 'thread/started':
        case 'thread/tokenUsage/updated':
        case 'turn/plan/updated':
        case 'turn/diff/updated':
          return {
            ...baseEvent('backend_event', ctx, {
              sourceType: streamMessage.type,
              method: streamMessage.method,
            }),
            kind: streamMessage.method,
            payload: params,
          }

        default:
          return null
      }
    }

    case 'collab_spawn_begin':
    case 'collab_spawn_end':
    case 'collab_interaction_begin':
    case 'collab_interaction_end':
    case 'collab_waiting_begin':
    case 'collab_waiting_end':
    case 'collab_close_begin':
    case 'collab_close_end':
    case 'collab_resume_begin':
    case 'collab_resume_end':
      return {
        ...baseEvent('backend_event', ctx),
        kind: streamMessage.type,
        payload: streamMessage,
      }
  }
}
