import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  VERSION,
  type AgentSession,
  type AgentSessionEvent,
  type SessionInfo,
} from '@mariozechner/pi-coding-agent'
import type { AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, Model, ToolResultMessage } from '@mariozechner/pi-ai'
import type {
  PiCommandPayload,
  PiForkMessagePayload,
  PiModelPayload,
  PiSessionInfo,
  PiStatePayload,
  PiStreamMessage,
} from '../types'
import {
  createPiExtensionUiBridge,
  type PiExtensionUiBridge,
  type PiExtensionUiResponseInput,
} from './pi_extension_ui'

type PiBridgeSyntheticEvent = {
  type: '__pi_bridge_stream__'
  streamMessage: PiStreamMessage
}

type PiEventListener = (event: AgentSessionEvent | PiBridgeSyntheticEvent) => void

export type GetOrCreatePiOptions = {
  provider?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  sessionPath?: string
}

export type PiAvailability = {
  available: boolean
  authenticated: boolean
  modelCount: number
  version?: string
}

export type PiInstance = {
  session: AgentSession
  resourceLoader: DefaultResourceLoader
  settingsManager: SettingsManager
  listeners: Set<PiEventListener>
  extensionUiBridge: PiExtensionUiBridge
  unsubscribe: () => void
  cwd: string
  createdAt: number
}

let authStorage: AuthStorage | null = null
let modelRegistry: ModelRegistry | null = null

const instances = new Map<string, PiInstance>()

const normalizeCwd = (cwd?: string): string => {
  const value = (cwd ?? '').trim()
  return resolve(value || process.cwd())
}

const getSessionsRoot = (): string => resolve(getAgentDir(), 'sessions')

export function getAuthStorage(): AuthStorage {
  if (!authStorage) {
    authStorage = new AuthStorage()
  }
  return authStorage
}

export function getModelRegistry(): ModelRegistry {
  if (!modelRegistry) {
    modelRegistry = new ModelRegistry(getAuthStorage())
  }
  return modelRegistry
}

async function buildInstance(cwd: string, options?: GetOrCreatePiOptions): Promise<PiInstance> {
  const settingsManager = SettingsManager.create(cwd)
  const resourceLoader = new DefaultResourceLoader({ cwd, settingsManager })
  await resourceLoader.reload()

  const sessionManager = options?.sessionPath
    ? SessionManager.open(options.sessionPath)
    : SessionManager.continueRecent(cwd)

  const registry = getModelRegistry()
  const model =
    options?.provider && options.modelId
      ? registry.find(options.provider, options.modelId)
      : undefined

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: options?.thinkingLevel,
    authStorage: getAuthStorage(),
    modelRegistry: registry,
    sessionManager,
    settingsManager,
    resourceLoader,
  })

  const listeners = new Set<PiEventListener>()

  const emitToListeners = (event: AgentSessionEvent | PiBridgeSyntheticEvent) => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // Listener errors should never crash the bridge.
      }
    }
  }

  const extensionUiBridge = createPiExtensionUiBridge((streamMessage) => {
    emitToListeners({
      type: '__pi_bridge_stream__',
      streamMessage,
    })
  })

  await session.bindExtensions({
    uiContext: extensionUiBridge.uiContext,
    commandContextActions: {
      waitForIdle: () => session.agent.waitForIdle(),
      newSession: async (setupOptions) => ({
        cancelled: !(await session.newSession(setupOptions)),
      }),
      fork: async (entryId) => {
        const result = await session.fork(entryId)
        return { cancelled: result.cancelled }
      },
      navigateTree: async (targetId, navOptions) => {
        const result = await session.navigateTree(targetId, {
          summarize: navOptions?.summarize,
          customInstructions: navOptions?.customInstructions,
          replaceInstructions: navOptions?.replaceInstructions,
          label: navOptions?.label,
        })
        return { cancelled: result.cancelled }
      },
      switchSession: async (sessionPath) => ({
        cancelled: !(await session.switchSession(sessionPath)),
      }),
      reload: async () => {
        await session.reload()
      },
    },
    onError: (error) => {
      extensionUiBridge.uiContext.notify(
        `[${error.extensionPath}] ${error.error}`,
        'error',
      )
    },
  })

  const unsubscribe = session.subscribe((event) => {
    emitToListeners(event)
  })

  return {
    session,
    resourceLoader,
    settingsManager,
    listeners,
    extensionUiBridge,
    unsubscribe,
    cwd,
    createdAt: Date.now(),
  }
}

export async function getOrCreateInstance(cwd?: string, options?: GetOrCreatePiOptions): Promise<PiInstance> {
  const normalizedCwd = normalizeCwd(cwd)
  const existing = instances.get(normalizedCwd)

  if (existing) {
    if (options?.sessionPath && existing.session.sessionFile !== options.sessionPath) {
      await existing.session.switchSession(options.sessionPath)
    }

    if (options?.provider && options.modelId) {
      const model = getModelRegistry().find(options.provider, options.modelId)
      if (model) {
        await existing.session.setModel(model)
      }
    }

    if (options?.thinkingLevel) {
      existing.session.setThinkingLevel(options.thinkingLevel)
    }

    return existing
  }

  const instance = await buildInstance(normalizedCwd, options)
  instances.set(normalizedCwd, instance)
  return instance
}

export async function addEventListener(cwd: string, listener: PiEventListener): Promise<() => void> {
  const instance = await getOrCreateInstance(cwd)
  instance.listeners.add(listener)
  return () => {
    instance.listeners.delete(listener)
  }
}

export function disposeInstance(cwd?: string): void {
  const normalizedCwd = normalizeCwd(cwd)
  const instance = instances.get(normalizedCwd)
  if (!instance) return

  instance.listeners.clear()
  instance.extensionUiBridge.dispose()
  instance.unsubscribe()
  instance.session.dispose()
  instances.delete(normalizedCwd)
}

export function disposeAll(): void {
  for (const cwd of instances.keys()) {
    disposeInstance(cwd)
  }
}

export function respondToExtensionUi(cwd: string, response: PiExtensionUiResponseInput): boolean {
  const instance = instances.get(normalizeCwd(cwd))
  if (!instance) return false

  return instance.extensionUiBridge.resolveResponse(response)
}

export async function listSessions(cwd?: string): Promise<PiSessionInfo[]> {
  const sessions = cwd
    ? await SessionManager.list(normalizeCwd(cwd))
    : await SessionManager.listAll()
  return sessions.map(mapSessionInfo)
}

export function listAvailableModels(): PiModelPayload[] {
  return getModelRegistry().getAvailable().map(mapModel)
}

export async function isPiAvailable(): Promise<PiAvailability> {
  try {
    const models = getModelRegistry().getAvailable()
    return {
      available: true,
      authenticated: models.length > 0,
      modelCount: models.length,
      version: VERSION,
    }
  } catch {
    return {
      available: false,
      authenticated: false,
      modelCount: 0,
    }
  }
}

export async function deleteSession(sessionPath: string): Promise<boolean> {
  const resolvedPath = resolve((sessionPath || '').trim())
  const sessionsRoot = getSessionsRoot()

  if (!resolvedPath.endsWith('.jsonl')) return false
  if (resolvedPath !== sessionsRoot && !resolvedPath.startsWith(`${sessionsRoot}${sep}`)) return false

  try {
    await rm(resolvedPath, { force: true })

    for (const instance of instances.values()) {
      const currentFile = instance.session.sessionFile ? resolve(instance.session.sessionFile) : null
      if (currentFile === resolvedPath) {
        await instance.session.newSession()
      }
    }

    return true
  } catch {
    return false
  }
}

export async function applySettings(instance: PiInstance, settings: Record<string, unknown>): Promise<void> {
  instance.settingsManager.applyOverrides(settings)
  await instance.session.reload()
}

export function getSettings(instance: PiInstance): Record<string, unknown> {
  return {
    global: instance.settingsManager.getGlobalSettings(),
    project: instance.settingsManager.getProjectSettings(),
  }
}

export function mapStatePayload(instance: PiInstance): PiStatePayload {
  return {
    model: instance.session.model ? mapModel(instance.session.model) : null,
    thinkingLevel: instance.session.thinkingLevel,
    isStreaming: instance.session.isStreaming,
    isCompacting: instance.session.isCompacting,
    isRetrying: instance.session.isRetrying,
    sessionFile: instance.session.sessionFile ?? null,
    sessionId: instance.session.sessionId,
    sessionName: instance.session.sessionName ?? null,
    steeringMode: instance.session.steeringMode,
    followUpMode: instance.session.followUpMode,
    autoCompactionEnabled: instance.session.autoCompactionEnabled,
    autoRetryEnabled: instance.session.autoRetryEnabled,
    messageCount: instance.session.messages.length,
    pendingMessageCount: instance.session.pendingMessageCount,
  }
}

export function listCommands(instance: PiInstance): PiCommandPayload[] {
  const skills = instance.resourceLoader.getSkills().skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: 'skill' as const,
    location: inferLocation(skill.filePath, instance.cwd),
    path: skill.filePath,
  }))

  const prompts = instance.resourceLoader.getPrompts().prompts.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: 'prompt' as const,
    location: inferLocation(prompt.filePath, instance.cwd),
    path: prompt.filePath,
  }))

  const extensionCommands =
    instance.session.extensionRunner
      ?.getRegisteredCommandsWithPaths()
      .map(({ command, extensionPath }) => ({
        name: command.name,
        description: command.description,
        source: 'extension' as const,
        location: inferLocation(extensionPath, instance.cwd),
        path: extensionPath,
      })) ?? []

  return [...skills, ...prompts, ...extensionCommands]
}

export function mapForkMessages(instance: PiInstance): PiForkMessagePayload[] {
  return instance.session.getUserMessagesForForking().map((message) => ({
    entryId: message.entryId,
    text: message.text,
  }))
}

const inferLocation = (filePath: string | undefined, cwd: string): 'user' | 'project' | 'path' | undefined => {
  if (!filePath) return undefined

  const normalized = resolve(filePath)
  const normalizedCwd = normalizeCwd(cwd)
  const normalizedAgentDir = resolve(getAgentDir())

  if (normalized === normalizedCwd || normalized.startsWith(`${normalizedCwd}${sep}`)) {
    return 'project'
  }

  if (normalized === normalizedAgentDir || normalized.startsWith(`${normalizedAgentDir}${sep}`)) {
    return 'user'
  }

  return 'path'
}

export function mapSessionInfo(session: SessionInfo): PiSessionInfo {
  return {
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    created: session.created.getTime(),
    modified: session.modified.getTime(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
  }
}

export function mapModel(model: Model<any>): PiModelPayload {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    api: String(model.api),
    contextWindow: Number(model.contextWindow ?? 0),
    maxTokens: Number(model.maxTokens ?? 0),
    reasoning: Boolean(model.reasoning),
    input: Array.isArray(model.input) ? model.input.map((entry) => String(entry)) : ['text'],
    cost: {
      input: Number(model.cost?.input ?? 0),
      output: Number(model.cost?.output ?? 0),
      cacheRead: Number(model.cost?.cacheRead ?? 0),
      cacheWrite: Number(model.cost?.cacheWrite ?? 0),
    },
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
      // Extract text from partial AgentToolResult.content array
      const rawPartial = event.partialResult
      let partialText: string | undefined
      if (rawPartial && typeof rawPartial === 'object' && Array.isArray((rawPartial as any).content)) {
        partialText = (rawPartial as any).content
          .filter((c: any) => c && c.type === 'text')
          .map((c: any) => c.text ?? '')
          .join('\n')
      } else if (typeof rawPartial === 'string') {
        partialText = rawPartial
      } else {
        partialText = rawPartial != null ? JSON.stringify(rawPartial) : undefined
      }
      return {
        type: 'tool-exec-update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: partialText,
      }
    }

    case 'tool_execution_end': {
      // Extract text from AgentToolResult.content array
      const rawResult = event.result
      let resultText: string | undefined
      let resultDetails: any = undefined
      if (rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as any).content)) {
        resultText = (rawResult as any).content
          .filter((c: any) => c && c.type === 'text')
          .map((c: any) => c.text ?? '')
          .join('\n')
        resultDetails = (rawResult as any).details
      } else if (typeof rawResult === 'string') {
        resultText = rawResult
      } else {
        resultText = rawResult != null ? JSON.stringify(rawResult) : undefined
      }
      return {
        type: 'tool-exec-end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: resultText,
        details: resultDetails,
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
