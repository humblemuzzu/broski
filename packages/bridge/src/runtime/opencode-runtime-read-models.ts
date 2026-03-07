import type {
  ProviderInfo,
  SessionStatusInfo,
  SessionSummary,
} from '../types'
import type {
  BroskiModelSummary,
  BroskiRuntimeCapabilities,
  BroskiRuntimeState,
  BroskiSessionSummary,
} from '../types/runtime'

const openCodeRuntimeCapabilities: BroskiRuntimeCapabilities = {
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
  canRetry: true,
  canRequestUserInput: true,
  canRequestPermissions: true,
  backendExtras: ['workspace-metadata', 'todos', 'projects'],
}

function normalizeTimestampMs(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function mapOpenCodeSessionToRuntimeSession(
  session: SessionSummary,
): BroskiSessionSummary {
  return {
    id: session.id,
    backend: 'opencode',
    title: session.title.trim() || session.id,
    cwd: session.directory,
    createdAtMs: normalizeTimestampMs(session.time.created),
    updatedAtMs: normalizeTimestampMs(session.time.updated),
    ...(session.summary ? { summary: session.summary } : {}),
    backendData: {
      ...(session.slug ? { slug: session.slug } : {}),
      ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
      ...(session.parentID ? { parentID: session.parentID } : {}),
      ...(session.project ? { project: session.project } : {}),
      ...(session.permission ? { permission: session.permission } : {}),
      capabilities: openCodeRuntimeCapabilities,
    },
  }
}

export function mapOpenCodeProvidersToRuntimeModels(
  providers: ProviderInfo,
): BroskiModelSummary[] {
  const models: BroskiModelSummary[] = []

  for (const provider of providers.all) {
    for (const model of Object.values(provider.models)) {
      models.push({
        id: model.id,
        backend: 'opencode',
        label: model.name || model.id,
        providerId: provider.id,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.outputLimit,
        supportsReasoning: model.reasoning,
        supportsImages:
          model.attachment === true ||
          model.modalities?.input?.includes('image') === true,
        supportsTools: model.toolCall,
        supportsMcp: true,
        backendData: {
          providerName: provider.name,
          ...(model.family ? { family: model.family } : {}),
          ...(model.status ? { status: model.status } : {}),
          ...(model.experimental !== undefined
              ? { experimental: model.experimental }
              : {}),
          ...(model.modalities ? { modalities: model.modalities } : {}),
          ...(model.pricing ? { pricing: model.pricing } : {}),
          ...(model.variants ? { variants: model.variants } : {}),
          capabilities: openCodeRuntimeCapabilities,
        },
      })
    }
  }

  return models
}

export function mapOpenCodeStatusToRuntimeState(
  sessionId: string,
  status: SessionStatusInfo,
  cwd?: string,
): BroskiRuntimeState {
  return {
    backend: 'opencode',
    sessionId,
    ...(cwd ? { cwd } : {}),
    isStreaming: status.type !== 'idle',
    isCompacting: false,
    isRetrying: status.type === 'retry',
    capabilities: openCodeRuntimeCapabilities,
    backendData: {
      status,
    },
  }
}
