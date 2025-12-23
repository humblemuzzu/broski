export type PermissionResponse = 'once' | 'always' | 'reject'

// Todo item from OpenCode SDK
export type Todo = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

// Slash command from OpenCode SDK
export type Command = {
  name: string
  description?: string
  builtin: boolean
}

// Agent from OpenCode SDK
export type Agent = {
  name: string
  description?: string
  color?: string
  mode: 'primary' | 'subagent' | 'all'
}

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
  | { type: 'chat'; sessionId: string; content: string; projectPath?: string; model?: { providerID: string; modelID: string }; agent?: string }
  | { type: 'abort'; sessionId: string; projectPath?: string }
  | { type: 'diff'; sessionId: string; projectPath?: string; messageId?: string }
  | { type: 'browse'; path: string; projectPath?: string }
  | { type: 'permission_response'; sessionId: string; permissionId: string; response: PermissionResponse; projectPath?: string }
  | { type: 'get_lsp_status'; projectPath?: string }
  | { type: 'get_session_context'; sessionId: string; projectPath?: string }
  // Feature 1: Todo/Plan Management
  | { type: 'get_todos'; sessionId: string; projectPath?: string }
  // Feature 2: Slash Commands
  | { type: 'list_commands'; projectPath?: string }
  | { type: 'execute_command'; sessionId: string; command: string; arguments: string; projectPath?: string; agent?: string; model?: string }
  // Feature 3: Agent Switching
  | { type: 'list_agents'; projectPath?: string }
  // Feature 4: Session Delete
  | { type: 'delete_session'; sessionId: string; projectPath?: string }
  // Feature 5: Session Update (Rename)
  | { type: 'update_session'; sessionId: string; title?: string; archived?: boolean; projectPath?: string }
  // Feature 6: Session Fork
  | { type: 'fork_session'; sessionId: string; messageId?: string; projectPath?: string }
  // Feature 7: Message Revert (Undo)
  | { type: 'revert_message'; sessionId: string; messageId: string; partId?: string; projectPath?: string }
  | { type: 'unrevert_session'; sessionId: string; projectPath?: string }
  // Feature 8: Session Share
  | { type: 'share_session'; sessionId: string; projectPath?: string }
  | { type: 'unshare_session'; sessionId: string; projectPath?: string }
  // Feature 9: Session Summarize (Compact)
  | { type: 'summarize_session'; sessionId: string; providerID: string; modelID: string; projectPath?: string }
  // Feature 10: Git/VCS Information
  | { type: 'get_vcs'; projectPath?: string }
  // Feature 11: File Content Read
  | { type: 'read_file'; path: string; projectPath?: string }
  // Feature 12: File Search
  | { type: 'find_files'; query: string; projectPath?: string }
  | { type: 'find_text'; pattern: string; include?: string; projectPath?: string }
  | { type: 'find_symbols'; query: string; projectPath?: string }
  // Feature 13: Session Status
  | { type: 'get_session_status'; projectPath?: string }
  // Feature 14: PTY Terminal Sessions
  | { type: 'list_pty'; projectPath?: string }
  | { type: 'create_pty'; command?: string; args?: string[]; cwd?: string; title?: string; projectPath?: string }
  | { type: 'get_pty'; ptyId: string; projectPath?: string }
  | { type: 'update_pty'; ptyId: string; title?: string; rows?: number; cols?: number; projectPath?: string }
  | { type: 'delete_pty'; ptyId: string; projectPath?: string }
  // Feature 15: MCP Server Management
  | { type: 'get_mcp_status'; projectPath?: string }
  | { type: 'connect_mcp'; name: string; projectPath?: string }
  | { type: 'disconnect_mcp'; name: string; projectPath?: string }
  // Feature 16: Full Provider Management
  | { type: 'list_all_providers'; projectPath?: string }
  | { type: 'get_provider_auth'; projectPath?: string }
  | { type: 'set_api_key'; providerID: string; key: string; projectPath?: string }
  // Feature 17: Tool List
  | { type: 'list_tool_ids'; projectPath?: string }
  | { type: 'list_tools'; provider: string; model: string; projectPath?: string }
  // Feature 18: File Status (Git)
  | { type: 'get_file_status'; projectPath?: string }
  // Feature 19: Formatter Status
  | { type: 'get_formatter_status'; projectPath?: string }
  // Feature 20: Session Init
  | { type: 'init_session'; sessionId: string; providerID: string; modelID: string; messageID: string; projectPath?: string }

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
  parentID?: string  // For forked sessions
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
  share?: {  // Feature 8: Session sharing info
    url: string
  }
}

// VCS/Git information from OpenCode SDK
export type VcsInfo = {
  branch?: string
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
  // Feature 1: Todo/Plan Management
  | { type: 'todos'; data: Todo[]; sessionId: string; requestId?: string }
  // Feature 2: Slash Commands
  | { type: 'commands'; data: Command[]; requestId?: string }
  | { type: 'command_executed'; data: unknown; sessionId: string; requestId?: string }
  // Feature 3: Agent Switching
  | { type: 'agents'; data: Agent[]; requestId?: string }
  // Feature 4: Session Delete
  | { type: 'session_deleted'; data: boolean; sessionId: string; requestId?: string }
  // Feature 5: Session Update (Rename)
  | { type: 'session_updated'; data: SessionSummary; sessionId: string; requestId?: string }
  // Feature 6: Session Fork
  | { type: 'session_forked'; data: SessionSummary; requestId?: string }
  // Feature 7: Message Revert (Undo)
  | { type: 'message_reverted'; data: SessionSummary; sessionId: string; requestId?: string }
  | { type: 'session_unreverted'; data: SessionSummary; sessionId: string; requestId?: string }
  // Feature 8: Session Share
  | { type: 'session_shared'; data: SessionSummary; sessionId: string; requestId?: string }
  | { type: 'session_unshared'; data: SessionSummary; sessionId: string; requestId?: string }
  // Feature 9: Session Summarize (Compact)
  | { type: 'session_summarized'; data: boolean; sessionId: string; requestId?: string }
  // Feature 10: Git/VCS Information
  | { type: 'vcs'; data: VcsInfo; requestId?: string }
  // Feature 11: File Content Read
  | { type: 'file_content'; data: FileContent; path: string; requestId?: string }
  // Feature 12: File Search
  | { type: 'files_found'; data: string[]; requestId?: string }
  | { type: 'text_found'; data: TextSearchResult[]; requestId?: string }
  | { type: 'symbols_found'; data: SymbolResult[]; requestId?: string }
  // Feature 13: Session Status
  | { type: 'session_status'; data: Record<string, SessionStatusInfo>; requestId?: string }
  // Feature 14: PTY Terminal Sessions
  | { type: 'pty_list'; data: PtySession[]; requestId?: string }
  | { type: 'pty_created'; data: PtySession; requestId?: string }
  | { type: 'pty'; data: PtySession; requestId?: string }
  | { type: 'pty_updated'; data: PtySession; requestId?: string }
  | { type: 'pty_deleted'; data: boolean; ptyId: string; requestId?: string }
  // Feature 15: MCP Server Management
  | { type: 'mcp_status'; data: Record<string, McpServerStatus>; requestId?: string }
  | { type: 'mcp_connected'; data: boolean; name: string; requestId?: string }
  | { type: 'mcp_disconnected'; data: boolean; name: string; requestId?: string }
  // Feature 16: Full Provider Management
  | { type: 'all_providers'; data: ProviderInfo; requestId?: string }
  | { type: 'provider_auth'; data: Record<string, ProviderAuthMethod[]>; requestId?: string }
  | { type: 'api_key_set'; data: boolean; providerID: string; requestId?: string }
  // Feature 17: Tool List
  | { type: 'tool_ids'; data: string[]; requestId?: string }
  | { type: 'tools'; data: ToolInfo[]; requestId?: string }
  // Feature 18: File Status (Git)
  | { type: 'file_status'; data: FileStatusInfo[]; requestId?: string }
  // Feature 19: Formatter Status
  | { type: 'formatter_status'; data: FormatterInfo[]; requestId?: string }
  // Feature 20: Session Init
  | { type: 'session_initialized'; data: boolean; sessionId: string; requestId?: string }

// Feature 11: File Content
export type FileContent = {
  content: string
  mime: string
}

// Feature 12: File Search Types
export type TextSearchResult = {
  path: string
  lineNumber: number
  lineText: string
  matches: Array<{
    text: string
    start: number
    end: number
  }>
}

export type SymbolResult = {
  name: string
  kind: string
  path: string
  line: number
  column: number
}

// Feature 13: Session Status
export type SessionStatusInfo = 
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number }

// Feature 14: PTY Session
export type PtySession = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: 'running' | 'exited'
  pid: number
  exitCode?: number
}

// Feature 15: MCP Server Status
export type McpServerStatus = {
  name: string
  status: 'connected' | 'disconnected' | 'connecting' | 'error'
  error?: string
  tools?: string[]
  resources?: string[]
}

// Feature 16: Provider Info
export type ProviderInfo = {
  all: ProviderDetails[]
  default: Record<string, string>
  connected: string[]
}

export type ProviderDetails = {
  id: string
  name: string
  models: Record<string, ModelInfo>
}

export type ModelInfo = {
  id: string
  name: string
  contextWindow?: number
  pricing?: {
    input: number
    output: number
  }
}

export type ProviderAuthMethod = {
  type: 'api' | 'oauth'
  name: string
  description?: string
  url?: string
}

// Feature 17: Tool Info
export type ToolInfo = {
  id: string
  name: string
  description?: string
  enabled: boolean
}

// Feature 18: File Status (Git)
export type FileStatusInfo = {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored'
  staged: boolean
}

// Feature 19: Formatter Info
export type FormatterInfo = {
  id: string
  name: string
  language?: string
  status: 'active' | 'inactive' | 'error'
  error?: string
}
