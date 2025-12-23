export type PermissionResponse = 'once' | 'always' | 'reject'

export type ClientMessage =
  | { type: 'list_projects' }
  | { type: 'list_sessions'; projectPath?: string }
  | { type: 'list_providers' }
  | { type: 'get_config' }
  | { type: 'set_model'; model: string }
  | { type: 'start_opencode' }
  | { type: 'create_session'; projectPath?: string; title?: string }
  | { type: 'get_session'; sessionId: string; projectPath?: string }
  | { type: 'get_session_messages'; sessionId: string; projectPath?: string; limit?: number }
  | { type: 'chat'; sessionId: string; content: string; projectPath?: string; model?: { providerID: string; modelID: string } }
  | { type: 'abort'; sessionId: string; projectPath?: string }
  | { type: 'diff'; sessionId: string; projectPath?: string; messageId?: string }
  | { type: 'browse'; path: string; projectPath?: string }
  | { type: 'permission_response'; sessionId: string; permissionId: string; response: PermissionResponse; projectPath?: string }
  | { type: 'get_lsp_status'; projectPath?: string }
  | { type: 'get_session_context'; sessionId: string; projectPath?: string }

export type ProjectSummary = {
  id: string
  name: string
  path: string
  lastOpened?: number
}

export type SessionSummary = {
  id: string
  title: string
  projectID: string
  directory: string
  time: {
    created: number
    updated: number
    compacting?: number
  }
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: Array<{
      file: string
      before: string
      after: string
      additions: number
      deletions: number
    }>
  }
}

// LSP server status from OpenCode SDK
export type LspServerStatus = {
  id: string
  name: string
  language?: string
  status: 'running' | 'stopped' | 'error'
  root?: string
}

// Session context info (tokens, cost, etc.) computed from messages
export type SessionContextInfo = {
  tokens: {
    input: number
    output: number
    total: number
    contextWindow: number // Model's max context
  }
  cost: number
  lsp: LspServerStatus[]
  modifiedFiles: Array<{
    file: string
    additions: number
    deletions: number
  }>
}

export type ServerMessage =
  | { type: 'projects'; data: ProjectSummary[]; requestId?: string }
  | { type: 'sessions'; data: SessionSummary[]; projectPath?: string; requestId?: string }
  | { type: 'providers'; data: unknown; requestId?: string }
  | { type: 'config'; data: unknown; requestId?: string }
  | { type: 'session'; data: SessionSummary; requestId?: string }
  | { type: 'session_messages'; data: unknown; sessionId: string; requestId?: string }
  | { type: 'session_created'; data: SessionSummary; requestId?: string }
  | { type: 'diff'; data: unknown; sessionId: string; requestId?: string }
  | { type: 'browse_result'; data: { path: string; items: unknown[] }; requestId?: string }
  | { type: 'sdk_event'; data: unknown }
  | { type: 'status'; data: { opencodeRunning: boolean } }
  | { type: 'error'; message: string; code?: string; requestId?: string }
  | { type: 'lsp_status'; data: LspServerStatus[]; requestId?: string }
  | { type: 'session_context'; data: SessionContextInfo; sessionId: string; requestId?: string }
