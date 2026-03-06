import type { CodexThread } from '../types'
import type {
  BroskiModelSummary,
  BroskiRuntimeCapabilities,
  BroskiRuntimeState,
  BroskiSessionSummary,
} from '../types/runtime'

export const codexRuntimeCapabilities: BroskiRuntimeCapabilities = {
  canStreamText: false,
  canStreamThinking: false,
  canUseTools: true,
  canPrompt: true,
  canAbort: true,
  canSwitchModel: true,
  canListSessions: true,
  canReadTranscript: true,
  canForkSession: true,
  canCompact: true,
  canRetry: false,
  canRequestUserInput: true,
  canRequestPermissions: true,
  backendExtras: ['collaboration', 'policy-amendments', 'review-threads'],
}

function normalizeTimestampMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function mapCodexThreadToRuntimeSession(
  thread: CodexThread & { threadName?: string },
): BroskiSessionSummary {
  const statusType = thread.status?.type
  return {
    id: thread.id,
    backend: 'codex',
    title: thread.threadName?.trim() || thread.preview.trim() || thread.id,
    cwd: thread.cwd,
    createdAtMs: normalizeTimestampMs(thread.createdAt),
    updatedAtMs: normalizeTimestampMs(thread.updatedAt),
    ...(statusType ? { isActive: statusType === 'active' || statusType === 'running' } : {}),
    ...(thread.modelProvider ? { modelLabel: thread.modelProvider } : {}),
    ...(thread.summary ? { summary: thread.summary } : {}),
    backendData: {
      ...(thread.cliVersion ? { cliVersion: thread.cliVersion } : {}),
      ...(thread.source ? { source: thread.source } : {}),
      ...(thread.gitInfo ? { gitInfo: thread.gitInfo } : {}),
      ...(thread.agentNickname ? { agentNickname: thread.agentNickname } : {}),
      ...(thread.agentRole ? { agentRole: thread.agentRole } : {}),
      ...(thread.status ? { status: thread.status } : {}),
      capabilities: codexRuntimeCapabilities,
    },
  }
}

export function mapCodexModelToSummary(model: Record<string, unknown>): BroskiModelSummary {
  const id = String(model.id ?? model.model ?? '')
  const reasoningEfforts = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : []

  return {
    id,
    backend: 'codex',
    label: String(model.displayName ?? model.model ?? id),
    providerId: 'openai',
    supportsReasoning: reasoningEfforts.length > 0,
    supportsImages: false,
    supportsTools: true,
    supportsMcp: true,
    backendData: {
      ...(model.description ? { description: model.description } : {}),
      ...(model.upgrade ? { upgrade: model.upgrade } : {}),
      ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
      ...(model.supportsPersonality !== undefined
          ? { supportsPersonality: model.supportsPersonality }
          : {}),
      ...(reasoningEfforts.length > 0
          ? { supportedReasoningEfforts: reasoningEfforts }
          : {}),
      ...(model.defaultReasoningEffort
          ? { defaultReasoningEffort: model.defaultReasoningEffort }
          : {}),
      capabilities: codexRuntimeCapabilities,
    },
  }
}

export function buildCodexRuntimeState({
  threadId,
  cwd,
  isStreaming,
  model,
}: {
  threadId: string
  cwd?: string
  isStreaming: boolean
  model?: string
}): BroskiRuntimeState {
  return {
    backend: 'codex',
    sessionId: threadId,
    ...(cwd ? { cwd } : {}),
    isStreaming,
    isCompacting: false,
    isRetrying: false,
    ...(model
        ? {
            model: {
              id: model,
              backend: 'codex',
              label: model,
              providerId: 'openai',
              supportsTools: true,
              supportsMcp: true,
            },
          }
        : {}),
    capabilities: codexRuntimeCapabilities,
  }
}
