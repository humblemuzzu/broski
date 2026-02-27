import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai'
import type { PiStreamMessage } from '../../types'

export type PiBridgeSyntheticEvent = {
  type: '__pi_bridge_stream__'
  streamMessage: PiStreamMessage
}

const extractText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const chunks: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if ((item as any).type === 'text' && typeof (item as any).text === 'string') {
      chunks.push((item as any).text)
    }
  }

  return chunks.join('')
}

const extractThinking = (content: unknown): string => {
  if (!Array.isArray(content)) return ''

  const chunks: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if ((item as any).type === 'thinking' && typeof (item as any).thinking === 'string') {
      chunks.push((item as any).thinking)
    }
  }

  return chunks.join('')
}

const extractToolCalls = (content: unknown): Array<{ id: string; name: string; arguments: any }> => {
  if (!Array.isArray(content)) return []

  const calls: Array<{ id: string; name: string; arguments: any }> = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if ((item as any).type !== 'toolCall') continue
    calls.push({
      id: String((item as any).id ?? ''),
      name: String((item as any).name ?? ''),
      arguments: (item as any).arguments,
    })
  }

  return calls
}

const extractToolResultText = (value: unknown): { text: string | undefined; details?: any } => {
  if (value && typeof value === 'object' && Array.isArray((value as any).content)) {
    const text = (value as any).content
      .filter((c: any) => c && c.type === 'text')
      .map((c: any) => c.text ?? '')
      .join('\n')
    return {
      text,
      details: (value as any).details,
    }
  }

  if (typeof value === 'string') {
    return { text: value }
  }

  return {
    text: value != null ? JSON.stringify(value) : undefined,
  }
}

export function mapAgentMessage(message: AgentMessage): any {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: extractText(message.content),
      timestamp: Number((message as any).timestamp ?? Date.now()),
    }
  }

  if (message.role === 'assistant') {
    const assistant = message as AssistantMessage
    return {
      role: 'assistant',
      text: extractText(assistant.content),
      thinking: extractThinking(assistant.content),
      toolCalls: extractToolCalls(assistant.content),
      model: assistant.model,
      provider: assistant.provider,
      usage: assistant.usage,
      stopReason: assistant.stopReason,
      timestamp: Number(assistant.timestamp ?? Date.now()),
    }
  }

  if (message.role === 'toolResult') {
    const toolResult = message as ToolResultMessage
    return {
      role: 'toolResult',
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      content: extractText(toolResult.content),
      details: (toolResult as any).details,
      isError: toolResult.isError,
      timestamp: Number(toolResult.timestamp ?? Date.now()),
    }
  }

  return {
    role: (message as any).role,
    ...(message as any),
  }
}

export function mapToolResult(message: ToolResultMessage): any {
  return {
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: extractText(message.content),
    details: (message as any).details,
    isError: message.isError,
    timestamp: Number(message.timestamp ?? Date.now()),
  }
}

export function translateEvent(event: AgentSessionEvent | PiBridgeSyntheticEvent): PiStreamMessage | null {
  if ((event as PiBridgeSyntheticEvent).type === '__pi_bridge_stream__') {
    return (event as PiBridgeSyntheticEvent).streamMessage
  }

  switch (event.type) {
    case 'agent_start':
      return { type: 'agent-start' }

    case 'agent_end':
      return {
        type: 'agent-end',
        messages: event.messages.map(mapAgentMessage),
      }

    case 'turn_start':
      return { type: 'turn-start' }

    case 'turn_end':
      return {
        type: 'turn-end',
        message: mapAgentMessage(event.message),
        toolResults: event.toolResults.map(mapToolResult),
      }

    case 'message_start':
      return {
        type: 'message-start',
        message: mapAgentMessage(event.message),
      }

    case 'message_end':
      return {
        type: 'message-end',
        message: mapAgentMessage(event.message),
      }

    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent
      if (assistantEvent.type === 'text_delta') {
        return { type: 'text-delta', content: assistantEvent.delta }
      }

      if (assistantEvent.type === 'thinking_delta') {
        return { type: 'thinking-delta', content: assistantEvent.delta }
      }

      if (assistantEvent.type === 'toolcall_start') {
        const content = assistantEvent.partial?.content?.[assistantEvent.contentIndex] as any
        if (content?.type === 'toolCall') {
          return {
            type: 'tool-call-start',
            toolCallId: String(content.id ?? ''),
            toolName: String(content.name ?? ''),
            args: content.arguments,
          }
        }
      }

      if (assistantEvent.type === 'toolcall_end') {
        return {
          type: 'tool-call-args-done',
          toolCallId: assistantEvent.toolCall.id,
          toolName: assistantEvent.toolCall.name,
          args: assistantEvent.toolCall.arguments,
        }
      }

      if (assistantEvent.type === 'done' || assistantEvent.type === 'error') {
        return {
          type: 'message-done',
          stopReason: String(assistantEvent.reason ?? 'stop'),
        }
      }

      return null
    }

    case 'tool_execution_start':
      return {
        type: 'tool-exec-start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }

    case 'tool_execution_update': {
      const partial = extractToolResultText(event.partialResult)
      return {
        type: 'tool-exec-update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: partial.text,
      }
    }

    case 'tool_execution_end': {
      const result = extractToolResultText(event.result)
      return {
        type: 'tool-exec-end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: result.text,
        details: result.details,
        isError: event.isError,
      }
    }

    case 'auto_compaction_start':
      return {
        type: 'compaction-start',
        reason: event.reason,
      }

    case 'auto_compaction_end':
      return {
        type: 'compaction-end',
        aborted: event.aborted,
        willRetry: event.willRetry,
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      }

    case 'auto_retry_start':
      return {
        type: 'retry-start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      }

    case 'auto_retry_end':
      return {
        type: 'retry-end',
        success: event.success,
        attempt: event.attempt,
        ...(event.finalError ? { finalError: event.finalError } : {}),
      }

    default:
      return null
  }
}
