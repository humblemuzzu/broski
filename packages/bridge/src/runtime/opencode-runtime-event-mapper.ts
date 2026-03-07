import type { BroskiRuntimeEvent } from '../types/runtime'
import { mapOpenCodeStatusToRuntimeState } from './opencode-runtime-read-models'

function extractSessionId(source: any): string | undefined {
  const value = source?.sessionID ?? source?.sessionId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractMessageId(source: any): string | undefined {
  const value = source?.messageID ?? source?.messageId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractToolCallId(source: any): string | undefined {
  const value = source?.callID ?? source?.callId ?? source?.call_id ?? source?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function baseEvent<TType extends BroskiRuntimeEvent['type']>(
  type: TType,
  backendData: Record<string, unknown> | undefined,
  sessionId?: string,
  cwd?: string,
) {
  return {
    type,
    backend: 'opencode' as const,
    timestampMs: Date.now(),
    ...(sessionId ? { sessionId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(backendData ? { backendData } : {}),
  }
}

export function mapOpenCodeSdkEventToRuntimeEvent(
  event: unknown,
): BroskiRuntimeEvent | null {
  const envelope = event as { directory?: unknown; payload?: any } | null
  const payload = envelope?.payload
  if (!payload || typeof payload !== 'object') return null

  const payloadType = typeof payload.type === 'string' ? payload.type : ''
  const properties = payload.properties ?? {}
  const cwd = typeof envelope?.directory === 'string' && envelope.directory !== 'global'
    ? envelope.directory
    : undefined
  const sessionId = extractSessionId(properties) ?? extractSessionId(properties.part)

  switch (payloadType) {
    case 'session.status': {
      if (!sessionId) return null
      const status = properties.status
      const state = mapOpenCodeStatusToRuntimeState(
        sessionId,
        status?.type === 'retry'
          ? {
              type: 'retry',
              attempt: Number(status.attempt ?? 0) || 0,
              message: String(status.message ?? ''),
              next: Number(status.next ?? 0) || 0,
            }
          : status?.type === 'busy'
            ? { type: 'busy' }
            : { type: 'idle' },
        cwd,
      )

      return {
        ...baseEvent('session_state_changed', { sourceType: payloadType }, sessionId, cwd),
        state,
      }
    }

    case 'session.idle': {
      if (!sessionId) return null
      return {
        ...baseEvent('session_state_changed', { sourceType: payloadType }, sessionId, cwd),
        state: mapOpenCodeStatusToRuntimeState(sessionId, { type: 'idle' }, cwd),
      }
    }

    case 'message.part.delta': {
      if (properties.field !== 'text' || typeof properties.delta !== 'string') {
        return null
      }
      return {
        ...baseEvent('assistant_text_delta', { sourceType: payloadType }, sessionId, cwd),
        ...(extractMessageId(properties) ? { messageId: extractMessageId(properties) } : {}),
        delta: properties.delta,
      }
    }

    case 'message.part.updated': {
      const part = properties.part
      if (!part || typeof part !== 'object') return null
      const partSessionId = extractSessionId(part) ?? sessionId
      const partMessageId = extractMessageId(part)

      if (part.type === 'reasoning') {
        const delta = typeof properties.delta === 'string'
          ? properties.delta
          : typeof part.text === 'string'
            ? part.text
            : ''
        if (!delta) return null
        return {
          ...baseEvent('assistant_thinking_delta', { sourceType: payloadType }, partSessionId, cwd),
          ...(partMessageId ? { messageId: partMessageId } : {}),
          delta,
        }
      }

      if (part.type === 'tool') {
        const toolCallId = extractToolCallId(part)
        const toolName = typeof part.tool === 'string' ? part.tool : undefined
        const state = part.state ?? {}
        const status = typeof state.status === 'string' ? state.status : 'pending'
        const metadata = state.metadata
        if (status === 'completed' || status === 'failed' || status === 'declined') {
          return {
            ...baseEvent(
              'tool_finished',
              {
                sourceType: payloadType,
                status,
                ...(metadata !== undefined ? { metadata } : {}),
              },
              partSessionId,
              cwd,
            ),
            ...(partMessageId ? { messageId: partMessageId } : {}),
            ...(toolCallId ? { toolCallId } : {}),
            ...(toolName ? { toolName } : {}),
            input: state.input,
            output: state.output,
            isError: status !== 'completed',
          }
        }

        return {
          ...baseEvent(
            state.output != null ? 'tool_updated' : 'tool_started',
            {
              sourceType: payloadType,
              status,
              ...(metadata !== undefined ? { metadata } : {}),
            },
            partSessionId,
            cwd,
          ),
          ...(partMessageId ? { messageId: partMessageId } : {}),
          ...(toolCallId ? { toolCallId } : {}),
          ...(toolName ? { toolName } : {}),
          input: state.input,
          ...(state.output != null ? { partialOutput: state.output } : {}),
        }
      }

      return null
    }

    case 'permission.asked':
    case 'permission.updated': {
      const permission = properties.permission ?? properties
      const permissionSessionId = extractSessionId(permission) ?? sessionId
      if (!permissionSessionId) return null
      return {
        ...baseEvent('permission_requested', { sourceType: payloadType }, permissionSessionId, cwd),
        request: {
          requestId:
            typeof permission.id === 'string'
              ? permission.id
              : typeof permission.requestID === 'string'
                ? permission.requestID
                : undefined,
          kind: typeof permission.permission === 'string' ? permission.permission : undefined,
          title:
            typeof permission.title === 'string'
              ? permission.title
              : 'Permission required',
          metadata: permission,
        },
      }
    }

    case 'question.asked': {
      if (!sessionId) return null
      return {
        ...baseEvent('user_input_requested', { sourceType: payloadType }, sessionId, cwd),
        request: {
          requestId:
            typeof properties.requestID === 'string'
              ? properties.requestID
              : typeof properties.requestId === 'string'
                ? properties.requestId
                : undefined,
          kind: 'question',
          title: typeof properties.title === 'string' ? properties.title : 'Input required',
          prompt:
            typeof properties.prompt === 'string'
              ? properties.prompt
              : typeof properties.message === 'string'
                ? properties.message
                : undefined,
          options: Array.isArray(properties.options)
            ? properties.options.map((value: unknown) => String(value))
            : undefined,
          metadata: properties,
        },
      }
    }

    case 'session.error':
      return {
        ...baseEvent('error', { sourceType: payloadType }, sessionId, cwd),
        message:
          typeof properties.message === 'string'
            ? properties.message
            : 'OpenCode session error',
        ...(typeof properties.code === 'string' ? { code: properties.code } : {}),
        ...(properties.error !== undefined ? { details: properties.error } : {}),
      }

    default:
      return null
  }
}
