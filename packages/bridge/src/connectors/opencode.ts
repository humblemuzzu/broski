import {
  createOpencodeClient,
  type GlobalEvent,
  type OpencodeClient,
  type Project,
  type Session,
} from '@opencode-ai/sdk/v2'
import { homedir } from 'os'
import { basename, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Agent, Command, FileAttachment, FileContent, FileStatusInfo, FormatterInfo, LspServerStatus, McpResource, McpServerStatus, PermissionRuleset, ProviderAuthMethod, ProviderInfo, ProjectSummary, PtySession, SessionContextInfo, SessionStatusInfo, SessionSummary, SymbolResult, TextSearchResult, Todo, ToolInfo, VcsInfo, Worktree } from '../types'

const DEFAULT_BASE_URL = 'http://localhost:4096'
const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === '1'

export type OpenCodeConnectorOptions = {
  baseUrl?: string
  client?: OpencodeClient
}

export class OpenCodeConnector {
  private client: OpencodeClient
  private baseUrl: string

  // Session list cache with 5s TTL (prevents redundant fetches)
  private sessionCache = new Map<string, { data: SessionSummary[]; fetchedAt: number }>()
  private readonly SESSION_CACHE_TTL_MS = 5000 // 5 seconds

  constructor(options: OpenCodeConnectorOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.client =
      options.client ??
      createOpencodeClient({
        baseUrl: this.baseUrl,
      })
  }

  // Update the base URL (useful for dynamic port discovery)
  updateBaseUrl(newBaseUrl: string) {
    this.baseUrl = newBaseUrl
    this.client = createOpencodeClient({
      baseUrl: newBaseUrl,
    })
  }

  get url(): string {
    return this.baseUrl
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/path`, {
        signal: AbortSignal.timeout(750),
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Get the current OpenCode instance directory
  async getInstanceDirectory(): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}/path`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) return null
      const data = await response.json()
      return data.directory ?? null
    } catch {
      return null
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    // v2 SDK: first arg is parameters, second arg is options
    const projects = (await this.client.project.list(
      {},
      { responseStyle: 'data' },
    )) ?? []
    return projects.map((project) => this.mapProject(project))
  }

  async listSessions(directory?: string): Promise<SessionSummary[]> {
    const cacheKey = directory ?? '__all__'
    const now = Date.now()
    const cached = this.sessionCache.get(cacheKey)

    if (cached && now - cached.fetchedAt < this.SESSION_CACHE_TTL_MS) {
      return cached.data
    }

    const result = await this._listSessionsInternal(directory)
    this.sessionCache.set(cacheKey, { data: result, fetchedAt: now })
    return result
  }

  invalidateSessionCache(directory?: string): void {
    if (directory) {
      this.sessionCache.delete(directory)
    }
    this.sessionCache.delete('__all__')
  }

  private async _listSessionsInternal(directory?: string): Promise<SessionSummary[]> {
    if (directory != null && directory.length > 0) {
      // v2 SDK: first arg is parameters, second arg is options
      const sessions =
        (await this.client.session.list(
          { directory },
          { responseStyle: 'data' },
        )) ?? []
      return sessions.map((session) => this.mapSession(session))
    }

    const projects = await this.listProjects().catch(() => [])
    const queue = projects.filter((p) => p.path.length > 0).slice()
    const sessionsById = new Map<string, SessionSummary>()

    const concurrency = 8
    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, async () => {
        for (;;) {
          const project = queue.shift()
          if (!project) break
          try {
            // v2 SDK: first arg is parameters, second arg is options
            const sessions =
              (await this.client.session.list(
                { directory: project.path },
                { responseStyle: 'data' },
              )) ?? []
            for (const session of sessions) {
              const mapped = this.mapSession(session)
              if ((mapped.time as any)?.archived) continue
              sessionsById.set(mapped.id, mapped)
            }
          } catch {
          }
        }
      }),
    )

    return Array.from(sessionsById.values()).sort((a, b) => {
      const aUpdated = a.time?.updated ?? 0
      const bUpdated = b.time?.updated ?? 0
      return bUpdated - aUpdated
    })
  }

  async createSession(
    directory?: string,
    title?: string,
    permission?: PermissionRuleset,
  ): Promise<SessionSummary> {
    const body: Record<string, unknown> = {}
    if (title && title.length > 0) body.title = title
    if (permission && permission.length > 0) body.permission = permission

    // v2 SDK: first arg is parameters, second arg is options
    const session = await this.client.session.create(
      {
        directory,
        ...(Object.keys(body).length > 0 ? body : {}),
      },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  async getSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.get(
      { sessionID: sessionId, directory },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  async getSessionMessages(sessionId: string, directory?: string, limit?: number) {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.messages(
      { sessionID: sessionId, directory, limit },
      { responseStyle: 'data' },
    )
  }

  async sendPrompt(
    sessionId: string,
    content: string,
    directory?: string,
    messageId?: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    fileAttachments?: FileAttachment[],
    variant?: string,
  ) {
    const parts: Array<{ type: string; text?: string; url?: string; filename?: string; mime?: string }> = [
      { type: 'text', text: content },
    ]

    if (fileAttachments && fileAttachments.length > 0) {
      const baseDir = directory ?? process.cwd()
      for (const attachment of fileAttachments) {
        if (attachment.base64Data && attachment.mimeType) {
          parts.push({
            type: 'file',
            url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
            filename: basename(attachment.path || 'image'),
            mime: attachment.mimeType,
          })
        } else {
          const absolutePath = isAbsolute(attachment.path)
            ? attachment.path 
            : join(baseDir, attachment.path)
          const filename = basename(attachment.path) || attachment.path
          parts.push({
            type: 'file',
            url: pathToFileURL(absolutePath).href,
            filename: attachment.isDirectory ? `${filename}/` : filename,
            mime: attachment.isDirectory ? 'inode/directory' : 'text/plain',
          })
        }
      }
    }
    
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.prompt(
      {
        sessionID: sessionId,
        directory,
        ...(messageId ? { messageID: messageId } : {}),
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        parts,
      },
      { responseStyle: 'data' },
    )
  }

  /**
   * Async prompt: returns immediately while the session runs in background.
   * Useful for background jobs.
   */
  async sendPromptAsync(
    sessionId: string,
    content: string,
    directory?: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    fileAttachments?: FileAttachment[],
    variant?: string,
  ) {
    const parts: Array<{ type: string; text?: string; url?: string; filename?: string; mime?: string }> = [
      { type: 'text', text: content },
    ]

    if (fileAttachments && fileAttachments.length > 0) {
      const baseDir = directory ?? process.cwd()
      for (const attachment of fileAttachments) {
        if (attachment.base64Data && attachment.mimeType) {
          parts.push({
            type: 'file',
            url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
            filename: basename(attachment.path || 'image'),
            mime: attachment.mimeType,
          })
        } else {
          const absolutePath = isAbsolute(attachment.path)
            ? attachment.path
            : join(baseDir, attachment.path)
          const filename = basename(attachment.path) || attachment.path
          parts.push({
            type: 'file',
            url: pathToFileURL(absolutePath).href,
            filename: attachment.isDirectory ? `${filename}/` : filename,
            mime: attachment.isDirectory ? 'inode/directory' : 'text/plain',
          })
        }
      }
    }

    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.promptAsync(
      {
        sessionID: sessionId,
        directory,
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        parts,
      },
      { responseStyle: 'data' },
    )
  }

  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.abort(
      { sessionID: sessionId, directory },
      { responseStyle: 'data' },
    )
  }

  async getSessionDiff(sessionId: string, directory?: string, messageId?: string) {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.diff(
      { sessionID: sessionId, directory, messageID: messageId },
      { responseStyle: 'data' },
    )
  }

  async listFiles(path: string, directory?: string) {
    // Expand ~ to actual home directory
    const resolvedPath = path === '~' || path.startsWith('~/') 
      ? path.replace(/^~/, homedir())
      : path
    
    // v2 SDK: first arg is parameters, second arg is options
    return this.client.file.list(
      { path: resolvedPath, directory },
      { responseStyle: 'data' },
    )
  }

  async listProviders() {
    // v2 SDK: first arg is parameters, second arg is options
    return this.client.config.providers({}, { responseStyle: 'data' })
  }

  async getConfig(directory?: string) {
    return this.getConfigForDirectory(directory)
  }

  async getConfigForDirectory(directory?: string) {
    // v2 SDK: first arg is parameters, second arg is options
    return this.client.config.get(
      directory ? { directory } : {},
      { responseStyle: 'data' },
    )
  }

  async updateConfig(config: Record<string, unknown>, directory?: string) {
    // v2 SDK: config.update({ directory?, config? })
    return this.client.config.update(
      {
        ...(directory && directory.length > 0 ? { directory } : {}),
        config: config as any,
      },
      { responseStyle: 'data' },
    )
  }

  async updateModel(model: string, directory?: string) {
    return this.updateConfig({ model }, directory)
  }

  async respondToPermission(
    requestId: string,
    response: 'once' | 'always' | 'reject',
    message?: string,
    directory?: string,
  ): Promise<boolean> {
    // Use the new permission.reply() API (replaces deprecated postSessionIdPermissionsPermissionId)
    // v2 SDK takes parameters as first arg and options as second arg
    return this.client.permission.reply(
      {
        requestID: requestId,
        directory,
        reply: response,
        message,
      },
      {
        responseStyle: 'data',
      },
    )
  }

  async listPendingPermissions(directory?: string): Promise<unknown[]> {
    try {
      const result = await this.client.permission.list(
        { directory },
        { responseStyle: 'data' },
      )
      return (result as any) ?? []
    } catch {
      return []
    }
  }

  async listPendingQuestions(directory?: string): Promise<unknown[]> {
    try {
      const result = await this.client.question.list(
        { directory },
        { responseStyle: 'data' },
      )
      return (result as any) ?? []
    } catch {
      return []
    }
  }

  async replyToQuestion(requestId: string, answers: string[][], directory?: string): Promise<boolean> {
    try {
      const url = new URL(`/question/${encodeURIComponent(requestId)}/reply`, this.baseUrl)
      if (directory) {
        url.searchParams.set('directory', directory)
      }
      const body = JSON.stringify({ answers })
      if (DEBUG_RTS) {
        console.log('[OC Connector] replyToQuestion:', {
          requestId,
          directory,
          url: url.toString(),
          body,
        })
      }
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        if (DEBUG_RTS) {
          const text = await res.text().catch(() => '<no body>')
          console.log('[OC Connector] replyToQuestion FAILED:', {
            requestId,
            status: res.status,
            statusText: res.statusText,
            body: text,
          })
        }
        return false
      }
      const data = await res.json().catch(() => null)
      if (DEBUG_RTS) {
        console.log('[OC Connector] replyToQuestion response:', {
          requestId,
          data,
          dataType: typeof data,
          isTrue: data === true,
        })
      }
      return data === true
    } catch (err) {
      if (DEBUG_RTS) {
        console.log('[OC Connector] replyToQuestion ERROR:', {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return false
    }
  }

  async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
    try {
      const url = new URL(`/question/${encodeURIComponent(requestId)}/reject`, this.baseUrl)
      if (directory) {
        url.searchParams.set('directory', directory)
      }
      if (DEBUG_RTS) {
        console.log('[OC Connector] rejectQuestion:', { requestId, directory, url: url.toString() })
      }
      const res = await fetch(url.toString(), {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        if (DEBUG_RTS) {
          const text = await res.text().catch(() => '<no body>')
          console.log('[OC Connector] rejectQuestion FAILED:', {
            requestId,
            status: res.status,
            statusText: res.statusText,
            body: text,
          })
        }
        return false
      }
      const data = await res.json().catch(() => null)
      if (DEBUG_RTS) {
        console.log('[OC Connector] rejectQuestion response:', { requestId, data })
      }
      return data === true
    } catch (err) {
      if (DEBUG_RTS) {
        console.log('[OC Connector] rejectQuestion ERROR:', {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return false
    }
  }

  async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController> {
    const controller = new AbortController()
    // v2 SDK: first arg is parameters, second arg is options
    const { stream } = await this.client.global.event(
      {},
      { signal: controller.signal, responseStyle: 'data' },
    )

    void (async () => {
      try {
        for await (const event of stream) {
          onEvent(event)
        }
      } catch {
        // Stream errors are surfaced via retries inside the SDK.
      }
    })()

    return controller
  }

  async getLspStatus(directory?: string): Promise<LspServerStatus[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const response = await this.client.lsp.status(
        { directory },
        { responseStyle: 'data' },
      )
      
      // Map SDK LSP status to our type
      const lspServers = response ?? []
      return lspServers.map((server: any) => ({
        id: server.id ?? 'unknown',
        name: server.name ?? server.id ?? 'LSP',
        status: server.status === 'connected' ? 'running' : 'error',
        root: server.root,
      }))
    } catch {
      // LSP endpoint might not be available
      return []
    }
  }

  async disposeInstance(directory?: string): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.instance.dispose(
        { directory },
        { responseStyle: 'data' },
      )
      return result === true
    } catch {
      return false
    }
  }

  async getSessionContext(sessionId: string, directory?: string): Promise<SessionContextInfo> {
    // Get session messages to compute token totals
    const messages = await this.getSessionMessages(sessionId, directory)
    
    // Get session diff for modified files
    const diffs = await this.getSessionDiff(sessionId, directory)
    
    // Get LSP status
    const lsp = await this.getLspStatus(directory)
    
    // Compute token totals from assistant messages
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let totalCost = 0
    let contextWindow = 200000 // Default fallback
    
    for (const msg of (messages ?? [])) {
      const info = msg?.info
      if (info?.role === 'assistant') {
        const tokens = info.tokens
        if (tokens) {
          inputTokens += tokens.input ?? 0
          outputTokens += tokens.output ?? 0
          reasoningTokens += tokens.reasoning ?? 0
          // Cache tokens may be nested under tokens.cache
          const cache = tokens.cache
          if (cache && typeof cache === 'object') {
            cacheReadTokens += cache.read ?? 0
            cacheWriteTokens += cache.write ?? 0
          }
        }
        totalCost += info.cost ?? 0
        // Extract context window from model metadata if available
        const modelMeta = info.model ?? info.metadata?.model
        if (modelMeta && typeof modelMeta === 'object') {
          const cw = modelMeta.contextWindow ?? modelMeta.context_window
          if (typeof cw === 'number' && cw > 0) {
            contextWindow = cw
          }
        }
      }
    }
    
    // Map diffs to modified files
    const modifiedFiles = (diffs ?? []).map((diff: any) => ({
      file: diff.file ?? '',
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0,
    }))
    
    return {
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
        contextWindow,
        reasoning: reasoningTokens || undefined,
        cacheRead: cacheReadTokens || undefined,
        cacheWrite: cacheWriteTokens || undefined,
      },
      cost: totalCost,
      lsp,
      modifiedFiles,
    }
  }

  // Feature 1: Todo/Plan Management
  async getTodos(sessionId: string, directory?: string): Promise<Todo[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses sessionID (capital ID), not id
      const todos = await this.client.session.todo(
        { sessionID: sessionId, directory },
        { responseStyle: 'data' },
      )
      return (todos ?? []).map((todo: any) => ({
        id: todo.id ?? '',
        content: todo.content ?? '',
        status: todo.status ?? 'pending',
        priority: todo.priority ?? 'medium',
      }))
    } catch {
      // Session might not have todos
      return []
    }
  }

  // Feature 2: Slash Commands
  async listCommands(directory?: string): Promise<Command[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const commands = await this.client.command.list(
        { directory },
        { responseStyle: 'data' },
      )
      return (commands ?? []).map((cmd: any) => ({
        name: cmd.name ?? '',
        description: cmd.description,
        builtin: cmd.builtin ?? false,
      }))
    } catch {
      // Commands endpoint might not be available
      return []
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args: string,
    directory?: string,
    agent?: string,
    model?: string,
  ): Promise<unknown> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    return this.client.session.command(
      {
        sessionID: sessionId,
        directory,
        command,
        arguments: args,
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
      },
      { responseStyle: 'data' },
    )
  }

  // Feature 3: Agent Switching
  async listAgents(directory?: string): Promise<Agent[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const agents = await this.client.app.agents(
        { directory },
        { responseStyle: 'data' },
      )
      return (agents ?? []).map((agent: any) => ({
        name: agent.name ?? '',
        description: agent.description,
        color: agent.color,
        mode: agent.mode ?? 'primary',
      }))
    } catch {
      // Agents endpoint might not be available
      return []
    }
  }

  // Feature 4: Session Delete
  async deleteSession(sessionId: string, directory?: string): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses sessionID (capital ID), not id
      await this.client.session.delete(
        { sessionID: sessionId, directory },
        { responseStyle: 'data' },
      )
      return true
    } catch {
      return false
    }
  }

  // Feature 5: Session Update (Rename)
  async updateSession(
    sessionId: string,
    title?: string,
    archived?: boolean,
    directory?: string,
  ): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.update(
      {
        sessionID: sessionId,
        directory,
        ...(title ? { title } : {}),
        ...(archived !== undefined ? { time: { archived: archived ? Date.now() : undefined } } : {}),
      },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  // Feature 6: Session Fork
  async forkSession(sessionId: string, messageId?: string, directory?: string): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.fork(
      {
        sessionID: sessionId,
        directory,
        ...(messageId ? { messageID: messageId } : {}),
      },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  // Feature 7: Message Revert (Undo)
  async revertMessage(
    sessionId: string,
    messageId: string,
    partId?: string,
    directory?: string,
  ): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.revert(
      {
        sessionID: sessionId,
        directory,
        messageID: messageId,
        ...(partId ? { partID: partId } : {}),
      },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  async unrevertSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.unrevert(
      { sessionID: sessionId, directory },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  // Feature 8: Session Share
  async shareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.share(
      { sessionID: sessionId, directory },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  async unshareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    // v2 SDK: first arg is parameters, second arg is options
    // Note: v2 SDK uses sessionID (capital ID), not id
    const session = await this.client.session.unshare(
      { sessionID: sessionId, directory },
      { responseStyle: 'data' },
    )
    return this.mapSession(session)
  }

  // Feature 9: Session Summarize (Compact)
  async summarizeSession(
    sessionId: string,
    providerID: string,
    modelID: string,
    directory?: string,
  ): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses sessionID (capital ID), not id
      await this.client.session.summarize(
        { sessionID: sessionId, directory, providerID, modelID },
        { responseStyle: 'data' },
      )
      return true
    } catch {
      return false
    }
  }

  // Feature 10: Git/VCS Information
  async getVcsInfo(directory?: string): Promise<VcsInfo> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const vcs = await this.client.vcs.get(
        { directory },
        { responseStyle: 'data' },
      )
      return {
        branch: vcs?.branch,
      }
    } catch {
      // VCS endpoint might not be available or not in a git repo
      return {}
    }
  }

  // Feature 11: File Content Read
  async readFile(path: string, directory?: string): Promise<FileContent> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.file.read(
        { path, directory },
        { responseStyle: 'data' },
      )
      return {
        content: result?.content ?? '',
        mime: result?.mime ?? 'text/plain',
      }
    } catch {
      return { content: '', mime: 'text/plain' }
    }
  }

  // Feature 12: File Search - Find files by name
  async findFiles(query: string, directory?: string): Promise<string[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.find.files(
        { query, directory },
        { responseStyle: 'data' },
      )
      return result ?? []
    } catch {
      return []
    }
  }

  // Feature 12b: File Search - Find files AND directories (for @ autocomplete)
  async searchFilesAndDirs(query: string, directory?: string, limit: number = 20): Promise<string[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.find.files(
        { query, dirs: 'true', directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).slice(0, limit)
    } catch {
      return []
    }
  }

  // Feature 12: File Search - Find text in files (ripgrep)
  async findText(pattern: string, include?: string, directory?: string): Promise<TextSearchResult[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.find.text(
        { pattern, include, directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((item: any) => ({
        path: item.path?.text ?? item.path ?? '',
        lineNumber: item.line_number ?? item.lineNumber ?? 0,
        lineText: item.lines?.text ?? '',
        matches: (item.submatches ?? []).map((m: any) => ({
          text: m.match?.text ?? '',
          start: m.start ?? 0,
          end: m.end ?? 0,
        })),
      }))
    } catch {
      return []
    }
  }

  // Feature 12: File Search - Find symbols (LSP)
  async findSymbols(query: string, directory?: string): Promise<SymbolResult[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.find.symbols(
        { query, directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((item: any) => ({
        name: item.name ?? '',
        kind: item.kind ?? 'unknown',
        path: item.path ?? item.location?.uri ?? '',
        line: item.line ?? item.location?.range?.start?.line ?? 0,
        column: item.column ?? item.location?.range?.start?.character ?? 0,
      }))
    } catch {
      return []
    }
  }

  // Feature 13: Session Status
  async getSessionStatus(directory?: string): Promise<Record<string, SessionStatusInfo>> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.session.status(
        { directory },
        { responseStyle: 'data' },
      )
      const mapped: Record<string, SessionStatusInfo> = {}
      for (const [sessionId, status] of Object.entries(result ?? {})) {
        const s = status as any
        if (s.type === 'busy') {
          mapped[sessionId] = { type: 'busy' }
        } else if (s.type === 'retry') {
          mapped[sessionId] = {
            type: 'retry',
            attempt: s.attempt ?? 0,
            message: s.message ?? '',
            next: s.next ?? 0,
          }
        } else {
          mapped[sessionId] = { type: 'idle' }
        }
      }
      return mapped
    } catch {
      return {}
    }
  }

  // Feature 14: PTY Terminal Sessions - List
  async listPty(directory?: string): Promise<PtySession[]> {
    try {
      // Use instance directory if none provided
      const dir = directory ?? await this.getInstanceDirectory()
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.pty.list(
        { directory: dir },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((pty: any) => this.mapPtySession(pty))
    } catch (error) {
      console.error('[PTY] listPty failed:', error)
      return []
    }
  }

  // Feature 14: PTY Terminal Sessions - Create
  async createPty(
    command?: string,
    args?: string[],
    cwd?: string,
    title?: string,
    directory?: string,
  ): Promise<PtySession | null> {
    try {
      // Use instance directory if none provided
      const dir = directory ?? await this.getInstanceDirectory()
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.pty.create(
        {
          directory: dir,
          ...(command ? { command } : {}),
          ...(args ? { args } : {}),
          ...(cwd ? { cwd } : {}),
          ...(title ? { title } : {}),
        },
        { responseStyle: 'data' },
      )
      return result ? this.mapPtySession(result) : null
    } catch (error) {
      console.error('[PTY] createPty failed:', error)
      return null
    }
  }

  // Feature 14: PTY Terminal Sessions - Get
  async getPty(ptyId: string, directory?: string): Promise<PtySession | null> {
    try {
      // Use instance directory if none provided
      const dir = directory ?? await this.getInstanceDirectory()
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses ptyID (capital ID), not id
      const result = await this.client.pty.get(
        { ptyID: ptyId, directory: dir },
        { responseStyle: 'data' },
      )
      return result ? this.mapPtySession(result) : null
    } catch (error) {
      console.error('[PTY] getPty failed:', error)
      return null
    }
  }

  // Feature 14: PTY Terminal Sessions - Update
  async updatePty(
    ptyId: string,
    title?: string,
    rows?: number,
    cols?: number,
    directory?: string,
  ): Promise<PtySession | null> {
    try {
      // Use instance directory if none provided
      const dir = directory ?? await this.getInstanceDirectory()
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses ptyID (capital ID), not id
      const result = await this.client.pty.update(
        {
          ptyID: ptyId,
          directory: dir,
          ...(title ? { title } : {}),
          ...(rows && cols ? { size: { rows, cols } } : {}),
        },
        { responseStyle: 'data' },
      )
      return result ? this.mapPtySession(result) : null
    } catch (error) {
      console.error('[PTY] updatePty failed:', error)
      return null
    }
  }

  // Feature 14: PTY Terminal Sessions - Delete
  async deletePty(ptyId: string, directory?: string): Promise<boolean> {
    try {
      // Use instance directory if none provided
      const dir = directory ?? await this.getInstanceDirectory()
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses ptyID (capital ID), not id
      await this.client.pty.remove(
        { ptyID: ptyId, directory: dir },
        { responseStyle: 'data' },
      )
      return true
    } catch (error: any) {
      console.error('[PTY] deletePty failed:', error?.message || error)
      // Return true if it's a 404 (already deleted) 
      if (error?.response?.status === 404) {
        return true
      }
      return false
    }
  }

  // Feature 15: MCP Server Management - Status
  async getMcpStatus(directory?: string): Promise<Record<string, McpServerStatus>> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.mcp.status(
        { directory },
        { responseStyle: 'data' },
      )
      const mapped: Record<string, McpServerStatus> = {}
      for (const [name, status] of Object.entries(result ?? {})) {
        const s = status as any
        mapped[name] = {
          name,
          status: s.status ?? 'disconnected',
          error: s.error,
          tools: s.tools ?? [],
          resources: s.resources ?? [],
        }
      }
      return mapped
    } catch {
      return {}
    }
  }

  // Feature 15: MCP Server Management - Connect
  async connectMcp(name: string, directory?: string): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      await this.client.mcp.connect(
        { name, directory },
        { responseStyle: 'data' },
      )
      return true
    } catch {
      return false
    }
  }

  // Feature 15: MCP Server Management - Disconnect
  async disconnectMcp(name: string, directory?: string): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      await this.client.mcp.disconnect(
        { name, directory },
        { responseStyle: 'data' },
      )
      return true
    } catch {
      return false
    }
  }

  // Feature 15b: MCP Resources (SDK v1.1.1+ experimental)
  async getMcpResources(directory?: string): Promise<Record<string, McpResource>> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.experimental.resource.list(
        { directory },
        { responseStyle: 'data' },
      )
      // Map the result to our McpResource type
      const mapped: Record<string, McpResource> = {}
      for (const [key, resource] of Object.entries(result ?? {})) {
        const r = resource as any
        mapped[key] = {
          name: r.name ?? '',
          uri: r.uri ?? '',
          description: r.description,
          mimeType: r.mimeType,
          client: r.client ?? '',
        }
      }
      return mapped
    } catch (error) {
      console.error('[getMcpResources] Error:', error)
      return {}
    }
  }

  // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
  async listWorktrees(directory?: string): Promise<Worktree[]> {
    try {
      // The SDK returns an array of directory strings, not full Worktree objects
      // We need to parse them or return basic info
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.worktree.list(
        { directory },
        { responseStyle: 'data' },
      )
      // The SDK experimental endpoint returns string[] of directories
      // Enrich with branch info by querying VCS for each directory.
      const dirs = result ?? []
      const concurrency = 6
      const queue = dirs.slice()
      const out: Worktree[] = []

      await Promise.all(
        Array.from({ length: Math.max(1, concurrency) }, async () => {
          for (;;) {
            const dir = queue.shift()
            if (!dir) break
            let branch = ''
            try {
              // v2 SDK pattern
              const vcs = await this.client.vcs.get(
                { directory: dir },
                { responseStyle: 'data' },
              )
              branch = (vcs as any)?.branch ?? ''
            } catch {
              branch = ''
            }
            out.push({
              name: basename(dir) || dir,
              branch,
              directory: dir,
            })
          }
        }),
      )

      return out.sort((a, b) => a.directory.localeCompare(b.directory))
    } catch (error) {
      console.error('[listWorktrees] Error:', error)
      return []
    }
  }

  async createWorktree(
    name?: string,
    startCommand?: string,
    directory?: string,
  ): Promise<Worktree | null> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.worktree.create(
        {
          directory,
          worktreeCreateInput: {
            name,
            startCommand,
          },
        },
        {
          responseStyle: 'data',
        },
      )
      if (!result) return null

      // IMPORTANT: The OpenCode SDK creates the git worktree but does NOT
      // register it in the project's sandboxes array. We need to "touch" the
      // new worktree directory with any API call to trigger Instance.provide()
      // -> Project.fromDirectory() -> sandboxes.push(). This makes the worktree
      // show up in listWorktrees() after app restart.
      if (result.directory) {
        try {
          // Any API call with the new directory will register it
          await this.client.vcs.get(
            { directory: result.directory },
            { responseStyle: 'data' },
          )
          console.log('[createWorktree] Registered sandbox:', result.directory)
        } catch {
          // Non-fatal: worktree was still created, just may not persist in list
          console.warn('[createWorktree] Failed to register sandbox, worktree may not persist in list')
        }
      }

      return {
        name: result.name ?? '',
        branch: result.branch ?? '',
        directory: result.directory ?? '',
      }
    } catch (error) {
      console.error('[createWorktree] Error:', error)
      return null
    }
  }

  async deleteWorktree(worktreeDirectory: string, directory?: string): Promise<boolean> {
    try {
      if (!directory || directory.length === 0) return false
      const target = isAbsolute(worktreeDirectory)
        ? worktreeDirectory
        : join(directory, worktreeDirectory)

      // Use the official OpenCode API for worktree removal.
      // This keeps OpenCode's internal sandbox/worktree bookkeeping consistent.
      const result = await this.client.worktree.remove(
        {
          directory,
          worktreeRemoveInput: { directory: target },
        },
        { responseStyle: 'data' },
      )

      return result === true
    } catch {
      return false
    }
  }

  // Feature 16: Full Provider Management - List all providers
  async listAllProviders(directory?: string): Promise<ProviderInfo> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.provider.list(
        { directory },
        { responseStyle: 'data' },
      )
      return {
        all: (result?.all ?? []).map((p: any) => ({
          id: p.id ?? '',
          name: p.name ?? p.id ?? '',
          models: p.models ?? {},
        })),
        default: result?.default ?? {},
        connected: result?.connected ?? [],
      }
    } catch {
      return { all: [], default: {}, connected: [] }
    }
  }

  // Feature 16: Full Provider Management - Get auth methods
  async getProviderAuth(directory?: string): Promise<Record<string, ProviderAuthMethod[]>> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.provider.auth(
        { directory },
        { responseStyle: 'data' },
      )
      const mapped: Record<string, ProviderAuthMethod[]> = {}
      for (const [providerId, methods] of Object.entries(result ?? {})) {
        mapped[providerId] = (methods as any[]).map((m: any) => ({
          type: m.type ?? 'api',
          name: m.name ?? '',
          description: m.description,
          url: m.url,
        }))
      }
      return mapped
    } catch {
      return {}
    }
  }

  // Feature 17: Tool List - Get tool IDs
  async listToolIds(directory?: string): Promise<string[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.tool.ids(
        { directory },
        { responseStyle: 'data' },
      )
      return result ?? []
    } catch (error) {
      console.error('[listToolIds] Error:', error)
      return []
    }
  }

  // Feature 17: Tool List - Get tools with details
  async listTools(provider: string, model: string, directory?: string): Promise<ToolInfo[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.tool.list(
        { provider, model, directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((tool: any) => ({
        id: tool.id ?? '',
        description: tool.description,
        parameters: tool.parameters,
      }))
    } catch {
      return []
    }
  }

  // Feature 18: File Status (Git)
  async getFileStatus(directory?: string): Promise<FileStatusInfo[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.file.status(
        { directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((f: any) => ({
        path: f.path ?? '',
        added: typeof f.added === 'number' ? f.added : 0,
        removed: typeof f.removed === 'number' ? f.removed : 0,
        status: f.status ?? 'modified',
      }))
    } catch {
      return []
    }
  }

  // Feature 19: Formatter Status
  async getFormatterStatus(directory?: string): Promise<FormatterInfo[]> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      const result = await this.client.formatter.status(
        { directory },
        { responseStyle: 'data' },
      )
      return (result ?? []).map((f: any) => ({
        id: f.id ?? '',
        name: f.name ?? f.id ?? '',
        language: f.language,
        status: f.status ?? 'inactive',
        error: f.error,
      }))
    } catch (error) {
      console.error('[getFormatterStatus] Error:', error)
      return []
    }
  }

  // Feature 20: Session Init (Create AGENTS.md)
  async initSession(
    sessionId: string,
    providerID: string,
    modelID: string,
    messageID: string,
    directory?: string,
  ): Promise<boolean> {
    try {
      // v2 SDK: first arg is parameters, second arg is options
      // Note: v2 SDK uses sessionID (capital ID), not id
      await this.client.session.init(
        { sessionID: sessionId, directory, providerID, modelID, messageID },
        { responseStyle: 'data' },
      )
      return true
    } catch {
      return false
    }
  }

  getPtyWebSocketUrl(ptyId: string, directory?: string): string {
    // Build the WebSocket URL for PTY connection
    // OpenCode exposes PTY I/O at ws://host:port/pty/{id}/connect
    // The /connect suffix is required - it's the WebSocket upgrade endpoint
    const wsUrl = this.baseUrl.replace('http', 'ws')
    const baseWsUrl = `${wsUrl}/pty/${ptyId}/connect`
    if (directory) {
      return `${baseWsUrl}?directory=${encodeURIComponent(directory)}`
    }
    return baseWsUrl
  }

  private mapPtySession(pty: any): PtySession {
    return {
      id: pty.id ?? '',
      title: pty.title ?? 'Terminal',
      command: pty.command ?? '',
      args: pty.args ?? [],
      cwd: pty.cwd ?? '',
      status: pty.status === 'running' ? 'running' : 'exited',
      pid: pty.pid ?? 0,
      exitCode: pty.exitCode,
    }
  }

  private mapProject(project: Project): ProjectSummary {
    const path = project.worktree
    const name = basename(path) || path
    return {
      id: project.id,
      name,
      path,
      lastOpened: project.time?.initialized ?? project.time?.created,
    }
  }

  private mapSession(session: Session): SessionSummary {
    return {
      id: session.id,
      title: session.title,
      projectID: session.projectID,
      directory: session.directory,
      parentID: (session as any).parentID,  // For forked sessions
      time: session.time,
      summary: session.summary,
      share: (session as any).share,  // Share URL if shared
      revert: (session as any).revert ?? undefined,
    }
  }
}
