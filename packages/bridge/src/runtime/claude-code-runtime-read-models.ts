import type {
  ClaudeCodeSession,
  ClaudeCodeSupportedModel,
} from '../types'
import type {
  BroskiModelSummary,
  BroskiRuntimeCapabilities,
  BroskiRuntimeState,
  BroskiSessionSummary,
} from '../types/runtime'

export const claudeCodeRuntimeCapabilities: BroskiRuntimeCapabilities = {
  canStreamText: true,
  canStreamThinking: true,
  canUseTools: true,
  canPrompt: true,
  canAbort: true,
  canSwitchModel: true,
  canListSessions: true,
  canReadTranscript: true,
  canForkSession: true,
  canCompact: true,
  canRetry: false,
  canRequestUserInput: false,
  canRequestPermissions: true,
  backendExtras: ['elicitation', 'checkpoints', 'subagents', 'local-config'],
}

function normalizeTimestampMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function mapClaudeCodeModelToSummary(
  model: ClaudeCodeSupportedModel,
): BroskiModelSummary {
  return {
    id: model.value,
    backend: 'claude-code',
    label: model.displayName || model.value,
    providerId: 'anthropic',
    supportsReasoning:
      model.supportsAdaptiveThinking === true || model.supportsEffort === true,
    supportsImages: true,
    supportsTools: true,
    supportsMcp: true,
    backendData: {
      source: 'supportedModels',
      description: model.description,
      ...(model.supportsEffort !== undefined
          ? { supportsEffort: model.supportsEffort }
          : {}),
      ...(model.supportedEffortLevels
          ? { supportedEffortLevels: model.supportedEffortLevels }
          : {}),
      ...(model.supportsAdaptiveThinking !== undefined
          ? { supportsAdaptiveThinking: model.supportsAdaptiveThinking }
          : {}),
      capabilities: claudeCodeRuntimeCapabilities,
    },
  }
}

export function mapClaudeCodeSessionToRuntimeSession(
  session: ClaudeCodeSession,
): BroskiSessionSummary {
  return {
    id: session.id,
    backend: 'claude-code',
    title: session.title?.trim() || session.id,
    cwd: session.cwd,
    createdAtMs: normalizeTimestampMs(session.createdAt),
    updatedAtMs: normalizeTimestampMs(session.updatedAt),
    ...(session.model ? { modelLabel: session.model } : {}),
    ...(session.summary ? { summary: session.summary } : {}),
    ...(session.isBackground !== undefined
        ? { isActive: session.isBackground === true }
        : {}),
    backendData: {
      ...(session.messageCount !== undefined
          ? { messageCount: session.messageCount }
          : {}),
      ...(session.isBackground !== undefined
          ? { isBackground: session.isBackground }
          : {}),
      ...(session.hasSubagentActivity !== undefined
          ? { hasSubagentActivity: session.hasSubagentActivity }
          : {}),
      ...(session.subagentName ? { subagentName: session.subagentName } : {}),
      capabilities: claudeCodeRuntimeCapabilities,
    },
  }
}

export function buildClaudeCodeRuntimeState({
  sessionId,
  cwd,
  isStreaming,
  model,
}: {
  sessionId: string
  cwd?: string
  isStreaming: boolean
  model?: string
}): BroskiRuntimeState {
  return {
    backend: 'claude-code',
    sessionId,
    ...(cwd ? { cwd } : {}),
    isStreaming,
    isCompacting: false,
    isRetrying: false,
    ...(model
        ? {
            model: {
              id: model,
              backend: 'claude-code',
              label: model,
              providerId: 'anthropic',
              supportsImages: true,
              supportsTools: true,
              supportsMcp: true,
            },
          }
        : {}),
    capabilities: claudeCodeRuntimeCapabilities,
  }
}
