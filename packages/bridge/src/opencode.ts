import {
  createOpencodeClient,
  type GlobalEvent,
  type OpencodeClient,
  type Project,
  type Session,
} from '@opencode-ai/sdk'
import type { PermissionResponse, ProjectSummary, SessionSummary } from './types'

const DEFAULT_BASE_URL = 'http://localhost:4096'

export type OpenCodeConnectorOptions = {
  baseUrl?: string
}

export class OpenCodeConnector {
  private client: OpencodeClient
  private baseUrl: string

  constructor(options: OpenCodeConnectorOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
      responseStyle: 'data',
    })
  }

  get url(): string {
    return this.baseUrl
  }

  async isRunning(): Promise<boolean> {
    try {
      await this.client.project.list({ responseStyle: 'data' })
      return true
    } catch {
      return false
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const projects = (await this.client.project.list({ responseStyle: 'data' })) ?? []
    return projects.map((project) => this.mapProject(project))
  }

  async listSessions(directory?: string): Promise<SessionSummary[]> {
    const sessions =
      (await this.client.session.list({
        responseStyle: 'data',
        query: directory ? { directory } : undefined,
      })) ?? []
    return sessions.map((session) => this.mapSession(session))
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
  ) {
    return this.client.session.prompt({
      responseStyle: 'data',
      path: { id: sessionId },
      query: directory ? { directory } : undefined,
      body: {
        ...(model ? { model } : {}),
        parts: [
          {
            type: 'text',
            text: content,
          },
        ],
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
    return this.client.file.list({
      responseStyle: 'data',
      query: {
        path,
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

  async startServer(): Promise<boolean> {
    const running = await this.isRunning()
    if (running) return true

    try {
      Bun.spawn(['opencode', 'serve'], {
        stdout: 'inherit',
        stderr: 'inherit',
      })
    } catch {
      return false
    }

    return this.waitForRunning()
  }

  private async waitForRunning(retries = 6, delayMs = 900): Promise<boolean> {
    for (var attempt = 0; attempt < retries; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (await this.isRunning()) return true
    }
    return false
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
      time: session.time,
      summary: session.summary,
    }
  }
}
