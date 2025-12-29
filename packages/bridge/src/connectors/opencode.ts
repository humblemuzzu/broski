import {
  createOpencodeClient,
  type GlobalEvent,
  type OpencodeClient,
  type Project,
  type Session,
} from '@opencode-ai/sdk'
import { homedir } from 'os'
import type { Agent, Command, FileContent, FileStatusInfo, FormatterInfo, LspServerStatus, McpServerStatus, PermissionResponse, ProviderAuthMethod, ProviderInfo, ProjectSummary, PtySession, SessionContextInfo, SessionStatusInfo, SessionSummary, SymbolResult, TextSearchResult, Todo, ToolInfo, VcsInfo } from './types'

const DEFAULT_BASE_URL = 'http://localhost:4096'

export type OpenCodeConnectorOptions = {
  baseUrl?: string
  client?: OpencodeClient
}

export class OpenCodeConnector {
  private client: OpencodeClient
  private baseUrl: string
  private toolIdsCache = new Map<string, { ids: string[]; fetchedAt: number }>()

  // Session list cache with 5s TTL (prevents redundant fetches)
  private sessionCache = new Map<string, { data: SessionSummary[]; fetchedAt: number }>()
  private readonly SESSION_CACHE_TTL_MS = 5000 // 5 seconds

  constructor(options: OpenCodeConnectorOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.client =
      options.client ??
      createOpencodeClient({
        baseUrl: this.baseUrl,
        responseStyle: 'data',
      })
  }

  // Update the base URL (useful for dynamic port discovery)
  updateBaseUrl(newBaseUrl: string) {
    this.baseUrl = newBaseUrl
    this.client = createOpencodeClient({
      baseUrl: newBaseUrl,
      responseStyle: 'data',
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

  async listProjects(): Promise<ProjectSummary[]> {
    const projects = (await this.client.project.list({ responseStyle: 'data' })) ?? []
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
      const sessions =
        (await this.client.session.list({
          responseStyle: 'data',
          query: { directory },
        })) ?? []
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
            const sessions =
              (await this.client.session.list({
                responseStyle: 'data',
                query: { directory: project.path },
              })) ?? []
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

  async createSession(directory?: string, title?: string): Promise<SessionSummary> {
    const session = await this.client.session.create({
      responseStyle: 'data',
      body: title ? { title } : undefined,
      query: directory ? { directory } : undefined,
    })
    return this.mapSession(session)
  }

  async getSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    const session = await this.client.session.get({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
    })
    return this.mapSession(session)
  }

  async getSessionMessages(sessionId: string, directory?: string, limit?: number) {
    return this.client.session.messages({
      responseStyle: 'data',
      path: { id: sessionId },
      query: {
        ...(directory ? { directory } : {}),
        ...(limit ? { limit } : {}),
      },
    })
  }

  async sendPrompt(
    sessionId: string,
    content: string,
    directory?: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
    disabledTools?: string[],
    fileAttachments?: FileAttachment[],
  ) {
    let tools: Record<string, boolean> | undefined
    if (disabledTools && disabledTools.length > 0) {
      const key = directory ?? 'global'
      const cached = this.toolIdsCache.get(key)
      const now = Date.now()
      const ttlMs = 30_000

      let ids: string[]
      if (cached && now - cached.fetchedAt < ttlMs) {
        ids = cached.ids
      } else {
        ids = await this.listToolIds(directory)
        this.toolIdsCache.set(key, { ids, fetchedAt: now })
      }

      tools = {}
      for (const id of ids) tools[id] = true
      for (const id of disabledTools) tools[id] = false
    }
    
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
            filename: attachment.path.split('/').pop() ?? 'image',
            mime: attachment.mimeType,
          })
        } else {
          const absolutePath = attachment.path.startsWith('/') 
            ? attachment.path 
            : `${baseDir}/${attachment.path}`
          const filename = attachment.path.split('/').pop() ?? attachment.path
          parts.push({
            type: 'file',
            url: `file://${absolutePath}`,
            filename: attachment.isDirectory ? `${filename}/` : filename,
            mime: attachment.isDirectory ? 'inode/directory' : 'text/plain',
          })
        }
      }
    }
    
    return this.client.session.prompt({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        ...(tools ? { tools } : {}),
        parts,
      },
    })
  }

  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    return this.client.session.abort({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
    })
  }

  async getSessionDiff(sessionId: string, directory?: string, messageId?: string) {
    return this.client.session.diff({
      responseStyle: 'data',
      path: { id: sessionId },
      query: {
        ...(directory ? { directory } : {}),
        ...(messageId ? { messageID: messageId } : {}),
      },
    })
  }

  async listFiles(path: string, directory?: string) {
    // Expand ~ to actual home directory
    const resolvedPath = path === '~' || path.startsWith('~/') 
      ? path.replace(/^~/, homedir())
      : path
    
    return this.client.file.list({
      responseStyle: 'data',
      query: {
        path: resolvedPath,
        ...(directory ? { directory } : {}),
      },
    })
  }

  async listProviders() {
    return this.client.config.providers({ responseStyle: 'data' })
  }

  async getConfig() {
    return this.client.config.get({ responseStyle: 'data' })
  }

  async updateModel(model: string) {
    return this.client.config.update({
      responseStyle: 'data',
      body: {
        model,
      },
    })
  }

  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: PermissionResponse,
    directory?: string,
  ): Promise<boolean> {
    return this.client.postSessionIdPermissionsPermissionId({
      responseStyle: 'data',
      path: { id: sessionId, permissionID: permissionId },
      query: directory ? { directory } : undefined,
      body: { response },
    })
  }

  async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController> {
    const controller = new AbortController()
    const { stream } = await this.client.global.event({
      signal: controller.signal,
      responseStyle: 'data',
    })

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
      const response = await this.client.lsp.list({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
      
      // Map SDK LSP status to our type
      const lspServers = response ?? []
      return lspServers.map((server: any) => ({
        id: server.id ?? server.name ?? 'unknown',
        name: server.name ?? server.id ?? 'LSP Server',
        language: server.language,
        status: server.status === 'running' ? 'running' : server.status === 'error' ? 'error' : 'stopped',
        root: server.root,
      }))
    } catch {
      // LSP endpoint might not be available
      return []
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
    let totalCost = 0
    
    for (const msg of (messages ?? [])) {
      const info = msg?.info
      if (info?.role === 'assistant') {
        const tokens = info.tokens
        if (tokens) {
          inputTokens += tokens.input ?? 0
          outputTokens += tokens.output ?? 0
        }
        totalCost += info.cost ?? 0
      }
    }
    
    // Map diffs to modified files
    const modifiedFiles = (diffs ?? []).map((diff: any) => ({
      file: diff.file ?? '',
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0,
    }))
    
    // Default context window (Claude 3.5 Sonnet has 200k)
    const contextWindow = 200000
    
    return {
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
        contextWindow,
      },
      cost: totalCost,
      lsp,
      modifiedFiles,
    }
  }

  // Feature 1: Todo/Plan Management
  async getTodos(sessionId: string, directory?: string): Promise<Todo[]> {
    try {
      const todos = await this.client.session.todo({
        responseStyle: 'data',
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
      })
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
      const commands = await this.client.command.list({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
    return this.client.session.command({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        command,
        arguments: args,
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
      },
    })
  }

  // Feature 3: Agent Switching
  async listAgents(directory?: string): Promise<Agent[]> {
    try {
      const agents = await this.client.app.agents({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      await this.client.session.delete({
        responseStyle: 'data',
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
      })
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
    const session = await this.client.session.update({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        ...(title ? { title } : {}),
        ...(archived !== undefined ? { time: { archived: archived ? Date.now() : undefined } } : {}),
      },
    })
    return this.mapSession(session)
  }

  // Feature 6: Session Fork
  async forkSession(sessionId: string, messageId?: string, directory?: string): Promise<SessionSummary> {
    const session = await this.client.session.fork({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: messageId ? { messageID: messageId } : undefined,
    })
    return this.mapSession(session)
  }

  // Feature 7: Message Revert (Undo)
  async revertMessage(
    sessionId: string,
    messageId: string,
    partId?: string,
    directory?: string,
  ): Promise<SessionSummary> {
    const session = await this.client.session.revert({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        messageID: messageId,
        ...(partId ? { partID: partId } : {}),
      },
    })
    return this.mapSession(session)
  }

  async unrevertSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    const session = await this.client.session.unrevert({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
    })
    return this.mapSession(session)
  }

  // Feature 8: Session Share
  async shareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    const session = await this.client.session.share({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
    })
    return this.mapSession(session)
  }

  async unshareSession(sessionId: string, directory?: string): Promise<SessionSummary> {
    const session = await this.client.session.unshare({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
    })
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
      await this.client.session.summarize({
        responseStyle: 'data',
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
        body: {
          providerID,
          modelID,
        },
      })
      return true
    } catch {
      return false
    }
  }

  // Feature 10: Git/VCS Information
  async getVcsInfo(directory?: string): Promise<VcsInfo> {
    try {
      const vcs = await this.client.vcs.get({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      const result = await this.client.file.read({
        responseStyle: 'data',
        query: {
          path,
          ...(directory ? { directory } : {}),
        },
      })
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
      const result = await this.client.find.files({
        responseStyle: 'data',
        query: {
          query,
          ...(directory ? { directory } : {}),
        },
      })
      return result ?? []
    } catch {
      return []
    }
  }

  // Feature 12b: File Search - Find files AND directories (for @ autocomplete)
  async searchFilesAndDirs(query: string, directory?: string, limit: number = 20): Promise<string[]> {
    try {
      const result = await this.client.find.files({
        responseStyle: 'data',
        query: {
          query,
          dirs: 'true',
          ...(directory ? { directory } : {}),
        },
      })
      return (result ?? []).slice(0, limit)
    } catch {
      return []
    }
  }

  // Feature 12: File Search - Find text in files (ripgrep)
  async findText(pattern: string, include?: string, directory?: string): Promise<TextSearchResult[]> {
    try {
      const result = await this.client.find.text({
        responseStyle: 'data',
        query: {
          pattern,
          ...(include ? { include } : {}),
          ...(directory ? { directory } : {}),
        },
      })
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
      const result = await this.client.find.symbols({
        responseStyle: 'data',
        query: {
          query,
          ...(directory ? { directory } : {}),
        },
      })
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
      const result = await this.client.session.status({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      const result = await this.client.pty.list({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
      return (result ?? []).map((pty: any) => this.mapPtySession(pty))
    } catch {
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
      const result = await this.client.pty.create({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
        body: {
          ...(command ? { command } : {}),
          ...(args ? { args } : {}),
          ...(cwd ? { cwd } : {}),
          ...(title ? { title } : {}),
        },
      })
      return result ? this.mapPtySession(result) : null
    } catch {
      return null
    }
  }

  // Feature 14: PTY Terminal Sessions - Get
  async getPty(ptyId: string, directory?: string): Promise<PtySession | null> {
    try {
      const result = await this.client.pty.get({
        responseStyle: 'data',
        path: { id: ptyId },
        query: directory ? { directory } : undefined,
      })
      return result ? this.mapPtySession(result) : null
    } catch {
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
      const result = await this.client.pty.update({
        responseStyle: 'data',
        path: { id: ptyId },
        query: directory ? { directory } : undefined,
        body: {
          ...(title ? { title } : {}),
          ...(rows && cols ? { size: { rows, cols } } : {}),
        },
      })
      return result ? this.mapPtySession(result) : null
    } catch {
      return null
    }
  }

  // Feature 14: PTY Terminal Sessions - Delete
  async deletePty(ptyId: string, directory?: string): Promise<boolean> {
    try {
      await this.client.pty.remove({
        responseStyle: 'data',
        path: { id: ptyId },
        query: directory ? { directory } : undefined,
      })
      return true
    } catch {
      return false
    }
  }

  // Feature 15: MCP Server Management - Status
  async getMcpStatus(directory?: string): Promise<Record<string, McpServerStatus>> {
    try {
      const result = await this.client.mcp.status({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      await this.client.mcp.connect({
        responseStyle: 'data',
        path: { name },
        query: directory ? { directory } : undefined,
      })
      return true
    } catch {
      return false
    }
  }

  // Feature 15: MCP Server Management - Disconnect
  async disconnectMcp(name: string, directory?: string): Promise<boolean> {
    try {
      await this.client.mcp.disconnect({
        responseStyle: 'data',
        path: { name },
        query: directory ? { directory } : undefined,
      })
      return true
    } catch {
      return false
    }
  }

  // Feature 16: Full Provider Management - List all providers
  async listAllProviders(directory?: string): Promise<ProviderInfo> {
    try {
      const result = await this.client.provider.list({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      const result = await this.client.provider.auth({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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

  // Feature 16: Full Provider Management - Set API key
  async setApiKey(providerID: string, key: string, directory?: string): Promise<boolean> {
    try {
      await this.client.auth.set({
        responseStyle: 'data',
        path: { provider: providerID },
        query: directory ? { directory } : undefined,
        body: {
          type: 'api',
          key,
        },
      })
      return true
    } catch {
      return false
    }
  }

  // Feature 17: Tool List - Get tool IDs
  async listToolIds(directory?: string): Promise<string[]> {
    try {
      const result = await this.client.tool.ids({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
      return result ?? []
    } catch (error) {
      console.error('[listToolIds] Error:', error)
      return []
    }
  }

  // Feature 17: Tool List - Get tools with details
  async listTools(provider: string, model: string, directory?: string): Promise<ToolInfo[]> {
    try {
      const result = await this.client.tool.list({
        responseStyle: 'data',
        query: {
          provider,
          model,
          ...(directory ? { directory } : {}),
        },
      })
      return (result ?? []).map((tool: any) => ({
        id: tool.id ?? tool.name ?? '',
        name: tool.name ?? tool.id ?? '',
        description: tool.description,
        enabled: tool.enabled ?? true,
      }))
    } catch {
      return []
    }
  }

  // Feature 18: File Status (Git)
  async getFileStatus(directory?: string): Promise<FileStatusInfo[]> {
    try {
      const result = await this.client.file.status({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
      return (result ?? []).map((f: any) => ({
        path: f.path ?? '',
        status: f.status ?? 'modified',
        staged: f.staged ?? false,
      }))
    } catch {
      return []
    }
  }

  // Feature 19: Formatter Status
  async getFormatterStatus(directory?: string): Promise<FormatterInfo[]> {
    try {
      const result = await this.client.formatter.status({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })
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
      await this.client.session.init({
        responseStyle: 'data',
        path: { id: sessionId },
        query: directory ? { directory } : undefined,
        body: {
          providerID,
          modelID,
          messageID,
        },
      })
      return true
    } catch {
      return false
    }
  }

  async disposeInstance(directory?: string): Promise<boolean> {
    try {
      const client = await this.getClient(directory)
      await client.instance.dispose()
      return true
    } catch {
      return false
    }
  }

  getPtyWebSocketUrl(ptyId: string, directory?: string): string {
    // Build the WebSocket URL for PTY connection
    // OpenCode exposes PTY I/O at ws://host:port/pty/{id}
    const wsUrl = this.baseUrl.replace('http', 'ws')
    const baseWsUrl = `${wsUrl}/pty/${ptyId}`
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
    const name = path.split('/').filter(Boolean).pop() ?? path
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
    }
  }
}
