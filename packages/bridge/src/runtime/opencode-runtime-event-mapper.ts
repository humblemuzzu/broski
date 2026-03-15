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

function extractPartId(source: any): string | undefined {
  const value = source?.partID ?? source?.partId ?? source?.part_id ?? source?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractToolCallId(source: any): string | undefined {
  const value = source?.callID ?? source?.callId ?? source?.call_id ?? source?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Mutable context passed into the mapper so it can track part types across
 * events.  The caller (server.ts / enqueueSdkEvent) creates this once and
 * re-uses it for the lifetime of the OC connection.
 */
export interface OpenCodeMapperContext {
  /** Part IDs that belong to reasoning parts (not regular text). */
  reasoningPartIds: Set<string>
  /** Last-emitted reasoning text per partID — used to compute real deltas. */
  lastReasoningTextByPartId: Map<string, string>
}

export function createOpenCodeMapperContext(): OpenCodeMapperContext {
  return {
    reasoningPartIds: new Set(),
    lastReasoningTextByPartId: new Map(),
  }
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
  ctx?: OpenCodeMapperContext,
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
      // Check if this delta belongs to a reasoning part — if so, route it as
      // a thinking delta instead of a text delta.  Without this guard the
      // reasoning content leaks into the visible response text while ALSO
      // appearing in the dedicated Thinking card (duplication bug).
      //
      // NOTE: OC SDK guarantees message.part.updated arrives before any
      // message.part.delta for the same partID (sequential awaits on one event
      // loop).  If that ordering ever changes, deltas arriving before the part
      // is registered will leak as assistant_text_delta.
      const deltaPartId = extractPartId(properties)
      if (deltaPartId && ctx?.reasoningPartIds.has(deltaPartId)) {
        // Track accumulated reasoning text so the final message.part.updated
        // can diff correctly and avoid re-emitting the entire thinking content.
        if (ctx) {
          const prev = ctx.lastReasoningTextByPartId.get(deltaPartId) ?? ''
          ctx.lastReasoningTextByPartId.set(deltaPartId, prev + properties.delta)
        }
        return {
          ...baseEvent('assistant_thinking_delta', { sourceType: payloadType }, sessionId, cwd),
          ...(extractMessageId(properties) ? { messageId: extractMessageId(properties) } : {}),
          delta: properties.delta,
        }
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
        // Register this part as reasoning so future message.part.delta events
        // for it are routed as thinking deltas, not text deltas.
        const reasoningPartId = extractPartId(part)
        if (reasoningPartId && ctx) {
          ctx.reasoningPartIds.add(reasoningPartId)
        }

        // Compute the real delta.  properties.delta is the true incremental
        // delta when present.  Otherwise part.text is the FULL accumulated
        // reasoning text — we must diff against what we already emitted to
        // avoid duplicating content in the Thinking card.
        let delta: string
        if (typeof properties.delta === 'string') {
          delta = properties.delta
        } else if (typeof part.text === 'string') {
          const prev = (reasoningPartId && ctx)
            ? (ctx.lastReasoningTextByPartId.get(reasoningPartId) ?? '')
            : ''
          delta = part.text.startsWith(prev)
            ? part.text.slice(prev.length)
            : part.text  // text was replaced, not appended — emit in full
        } else {
          delta = ''
        }
        // Track the full text so the next update can diff correctly.
        if (reasoningPartId && ctx && typeof part.text === 'string') {
          ctx.lastReasoningTextByPartId.set(reasoningPartId, part.text)
        }
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
        // SDK ToolState statuses: pending, running, completed, error
        // Also handle 'failed' and 'declined' defensively.
        if (status === 'completed' || status === 'error' || status === 'failed' || status === 'declined') {
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
            output: state.error ?? state.output,
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

      // Remaining part types (text for user messages, file, agent, retry, subtask,
      // compaction, patch, snapshot, step-start, step-finish, etc.) — pass through
      // as backend_event so the Flutter side can handle OC-specific lifecycle.
      const partType = typeof part.type === 'string' ? part.type : ''
      // Tool and reasoning parts are already mapped to runtime events above, skip them
      if (partType === 'tool' || partType === 'reasoning') return null
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, partSessionId, cwd),
        kind: `message.part.${partType || 'unknown'}`,
        payload: properties,
      }
    }

    case 'message.updated':
    case 'message.removed':
    case 'message.part.removed':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'session.diff':
    case 'todo.updated':
    case 'session.compacted':
    case 'vcs.branch.updated':
    case 'mcp.tools.changed':
    case 'mcp.browser.open.failed':
    case 'workspace.ready':
    case 'workspace.failed':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'question.replied':
    case 'question.rejected':
    case 'permission.replied':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'permission.asked':
    case 'permission.updated': {
      // For permission.asked, `properties` IS the PermissionRequest object:
      //   { id, sessionID, permission: "bash", patterns, metadata, always, tool? }
      // properties.permission is the permission TYPE string (e.g. "bash"), NOT a nested object.
      // Guard against any hypothetical legacy format where permission data is nested.
      const permData =
        properties.permission != null && typeof properties.permission === 'object'
          ? properties.permission
          : properties
      const permissionSessionId = extractSessionId(permData) ?? sessionId
      if (!permissionSessionId) return null
      return {
        ...baseEvent('permission_requested', { sourceType: payloadType }, permissionSessionId, cwd),
        request: {
          requestId:
            typeof permData.id === 'string'
              ? permData.id
              : typeof permData.requestID === 'string'
                ? permData.requestID
                : undefined,
          kind: typeof permData.permission === 'string' ? permData.permission : undefined,
          title:
            typeof permData.title === 'string'
              ? permData.title
              : 'Permission required',
          metadata: permData,
        },
      }
    }

    case 'question.asked': {
      if (!sessionId) return null
      // SDK's QuestionRequest = { id, sessionID, questions: QuestionInfo[], tool? }
      // The primary identifier is `id`, not `requestID` (reply events use requestID).
      return {
        ...baseEvent('user_input_requested', { sourceType: payloadType }, sessionId, cwd),
        request: {
          requestId:
            typeof properties.id === 'string'
              ? properties.id
              : typeof properties.requestID === 'string'
                ? properties.requestID
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

    // ── Newly-mapped events (Phase 1B) ──────────────────────────────────
    case 'session.created':
    case 'session.updated':
    case 'session.deleted':
    case 'project.updated':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'pty.created':
    case 'pty.updated':
    case 'pty.exited':
    case 'pty.deleted':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'worktree.ready':
    case 'worktree.failed':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'lsp.updated':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'file.edited':
      return {
        ...baseEvent('backend_event', { sourceType: payloadType }, sessionId, cwd),
        kind: payloadType,
        payload: properties,
      }

    case 'session.error': {
      // SDK: EventSessionError.properties = { sessionID?, error?: { name: string, data: { message: string, ... } } }
      const errorObj = properties.error
      const errorName = typeof errorObj?.name === 'string' ? errorObj.name : undefined
      const errorMessage = typeof errorObj?.data?.message === 'string' ? errorObj.data.message : undefined
      return {
        ...baseEvent('error', { sourceType: payloadType }, sessionId, cwd),
        message: errorMessage ?? 'OpenCode session error',
        ...(errorName ? { code: errorName } : {}),
        ...(errorObj !== undefined ? { details: errorObj } : {}),
      }
    }

    default:
      return null
  }
}
