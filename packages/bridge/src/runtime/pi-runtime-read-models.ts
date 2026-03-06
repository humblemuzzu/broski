import type {
  PiModelPayload,
  PiSessionInfo,
  PiStatePayload,
} from '../types/pi'
import type {
  BroskiModelSummary,
  BroskiRuntimeCapabilities,
  BroskiRuntimeState,
  BroskiSessionSummary,
} from '../types/runtime'

const piRuntimeCapabilities: BroskiRuntimeCapabilities = {
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
  canRequestPermissions: false,
  backendExtras: ['extension-ui', 'steering-mode', 'follow-up-mode', 'tree-navigation'],
}

const pickSessionTitle = (session: PiSessionInfo): string => {
  const name = session.name?.trim()
  if (name) return name

  const firstMessage = session.firstMessage.trim()
  if (firstMessage) return firstMessage

  return session.id
}

export function mapPiModelToSummary(piModel: PiModelPayload): BroskiModelSummary {
  return {
    id: piModel.id,
    backend: 'pi',
    label: piModel.name,
    providerId: piModel.provider,
    contextWindow: piModel.contextWindow,
    maxOutputTokens: piModel.maxTokens,
    supportsReasoning: piModel.reasoning,
    supportsImages: piModel.input.includes('image'),
    supportsTools: true,
    supportsMcp: false,
    backendData: {
      api: piModel.api,
      input: piModel.input,
      cost: piModel.cost,
    },
  }
}

export function mapPiStateToRuntimeState(piState: PiStatePayload): BroskiRuntimeState {
  return {
    backend: 'pi',
    sessionId: piState.sessionId,
    isStreaming: piState.isStreaming,
    isCompacting: piState.isCompacting,
    isRetrying: piState.isRetrying,
    pendingMessageCount: piState.pendingMessageCount,
    ...(piState.model ? { model: mapPiModelToSummary(piState.model) } : {}),
    thinkingLevel: piState.thinkingLevel,
    capabilities: piRuntimeCapabilities,
    backendData: {
      sessionFile: piState.sessionFile,
      sessionName: piState.sessionName,
      steeringMode: piState.steeringMode,
      followUpMode: piState.followUpMode,
      autoCompactionEnabled: piState.autoCompactionEnabled,
      autoRetryEnabled: piState.autoRetryEnabled,
      messageCount: piState.messageCount,
    },
  }
}

export function mapPiSessionToRuntimeSession(session: PiSessionInfo): BroskiSessionSummary {
  return {
    id: session.id,
    backend: 'pi',
    title: pickSessionTitle(session),
    cwd: session.cwd,
    createdAtMs: session.created,
    updatedAtMs: session.modified,
    ...(session.summary ? { summary: session.summary } : {}),
    backendData: {
      path: session.path,
      parentSessionPath: session.parentSessionPath,
      messageCount: session.messageCount,
      firstMessage: session.firstMessage,
    },
  }
}
