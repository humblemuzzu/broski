import { rm } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
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
import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
import type {
  PiCommandPayload,
  ProjectSummary,
  PiForkMessagePayload,
  PiModelPayload,
  PiQueueState,
  PiSessionInfo,
  PiStatePayload,
  PiThinkingCapabilities,
  PiToolInfo,
} from '../types'
import {
  createPiExtensionUiBridge,
  type PiExtensionUiBridge,
  type PiExtensionUiResponseInput,
} from './pi_extension_ui'
import type { PiBridgeSyntheticEvent } from './pi/pi-events'
import { computePiSessionStats } from './pi/pi-session-stats'

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

export type PiActiveRuntimeState = {
  cwd: string
  state: PiStatePayload
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
    authStorage = AuthStorage.create()
  }
  return authStorage
}

export function getModelRegistry(): ModelRegistry {
  if (!modelRegistry) {
    modelRegistry = new ModelRegistry(getAuthStorage())
  }
  return modelRegistry
}

const drainAuthStorageErrors = (): void => {
  const errors = getAuthStorage().drainErrors()
  for (const error of errors) {
    console.warn(`[pi-auth-storage] ${error.message}`)
  }
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
  const mapped = sessions.map(mapSessionInfo)
  await enrichSessionsWithStats(mapped)
  return mapped
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const sessions = await SessionManager.listAll()
  const byPath = new Map<string, { path: string; name: string; lastOpened: number }>()

  for (const session of sessions) {
    const cwd = session.cwd
    if (!cwd) continue

    const path = resolve(cwd)
    const lastOpened = session.modified.getTime()
    const existing = byPath.get(path)

    if (!existing || lastOpened > existing.lastOpened) {
      byPath.set(path, {
        path,
        name: basename(path) || path,
        lastOpened,
      })
    }
  }

  return Array.from(byPath.values())
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .map((p) => ({
      id: p.path,
      name: p.name,
      path: p.path,
      lastOpened: p.lastOpened,
    }))
}

export function listAvailableModels(): PiModelPayload[] {
  return getModelRegistry().getAvailable().map(mapModel)
}

export function listAllModels(): PiModelPayload[] {
  return getModelRegistry().getAll().map(mapModel)
}

export function refreshModels(): void {
  getModelRegistry().refresh()
}

export async function isPiAvailable(): Promise<PiAvailability> {
  try {
    const models = getModelRegistry().getAvailable()
    drainAuthStorageErrors()
    return {
      available: true,
      authenticated: models.length > 0,
      modelCount: models.length,
      version: VERSION,
    }
  } catch {
    drainAuthStorageErrors()
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
  await instance.settingsManager.flush()
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
    isBashRunning: instance.session.isBashRunning,
    hasPendingBashMessages: instance.session.hasPendingBashMessages,
    retryAttempt: instance.session.retryAttempt,
  }
}

export function listActiveRuntimeStates(): PiActiveRuntimeState[] {
  return Array.from(instances.values()).map((instance) => ({
    cwd: instance.cwd,
    state: mapStatePayload(instance),
  }))
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
    // summary is populated asynchronously by enrichSessionsWithStats()
  }
}

/** Enrich a list of Pi sessions with diff stats (computed in parallel, cached by mtime). */
export async function enrichSessionsWithStats(sessions: PiSessionInfo[]): Promise<void> {
  await Promise.all(
    sessions.map(async (session) => {
      if (!session.path) return
      const summary = await computePiSessionStats(session.path)
      if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
        session.summary = summary
      }
    }),
  )
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
    authenticated: getModelRegistry().getAvailable().some(m => m.id === model.id && m.provider === model.provider),
    isOAuth: getModelRegistry().isUsingOAuth(model),
  }
}

export { mapAgentMessage, mapToolResult, translateEvent } from './pi/pi-events'
