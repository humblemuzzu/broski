import type {
  Artifact,
  ArtifactSearchFilters,
  ArtifactSearchQuery,
  ArtifactSearchResult,
  ArtifactsConfig,
  ArtifactsEnrichmentEvent,
  ArtifactsStats,
} from './artifacts/types'

export type PermissionResponse = 'once' | 'always' | 'reject'

// Todo item from OpenCode SDK
export type Todo = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

// Slash command from OpenCode SDK
// See: https://opencode.ai/docs/commands
export type Command = {
  name: string
  description?: string
  builtin: boolean
  agent?: string    // Specific agent to use (e.g., "build", "plan")
  model?: string    // Specific model to use (e.g., "anthropic/claude-sonnet-4")
  template?: string // Command template (for custom commands)
  subtask?: boolean // Run as background subtask
}

// Agent from OpenCode SDK
export type Agent = {
  name: string
  description?: string
  color?: string
  mode: 'primary' | 'subagent' | 'all'
}

// Agent type for multi-agent support
export type AgentType = 'opencode' | 'claude-code'

// Device information for multi-device support
export type DeviceInfo = {
  deviceId: string
  deviceName: string
  platform: string
  connectionType: 'local' | 'tailscale' | 'unknown'
  rttMs: number
  connectedAt: number
  currentView?: { projectPath?: string; sessionId?: string }
}

export type ClientMessage =
  | { type: 'batch'; messages: Array<ClientMessage & { requestId?: string }>; count?: number; timestamp?: number }
  | { type: 'set_view'; projectPath?: string; sessionId?: string }
  | { type: 'set_agent'; agent: AgentType }
  | { type: 'restart_opencode' }
  | { type: 'pong'; id: string; sentAt: number }
  // Client-initiated ping (for app lifecycle detection)
  | { type: 'client_ping'; id: string; sentAt: number }
  // Multi-device support
  | { type: 'register_device'; deviceId: string; deviceName: string; platform: string }
  | { type: 'list_devices' }
  | { type: 'disconnect_device'; deviceId: string }
  | { type: 'list_projects' }
  | { type: 'list_sessions'; projectPath?: string }
  | { type: 'list_providers' }
  | { type: 'get_config' }
  | { type: 'set_model'; model: string }
  | { type: 'create_session'; projectPath?: string; title?: string }
  | { type: 'get_session'; sessionId: string; projectPath?: string }
  | { type: 'get_session_messages'; sessionId: string; projectPath?: string; limit?: number }
  | { type: 'chat'; sessionId: string; content: string; projectPath?: string; model?: { providerID: string; modelID: string }; agent?: string; disabledTools?: string[]; fileAttachments?: FileAttachment[] }
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
  // Feature 21: Binary File Content Read (images, PDFs, etc.)
  | { type: 'read_file_binary'; path: string; maxSizeMb?: number }
  // Feature 12: File Search
  | { type: 'find_files'; query: string; projectPath?: string }
  | { type: 'find_text'; pattern: string; include?: string; projectPath?: string }
  | { type: 'find_symbols'; query: string; projectPath?: string }
  | { type: 'search_files_and_dirs'; query: string; projectPath?: string }
  // Feature 13: Session Status
  | { type: 'get_session_status'; projectPath?: string }
  // Feature 14: PTY Terminal Sessions
  | { type: 'list_pty'; projectPath?: string }
  | { type: 'create_pty'; command?: string; args?: string[]; cwd?: string; title?: string; projectPath?: string }
  | { type: 'get_pty'; ptyId: string; projectPath?: string }
  | { type: 'update_pty'; ptyId: string; title?: string; rows?: number; cols?: number; projectPath?: string }
  | { type: 'delete_pty'; ptyId: string; projectPath?: string }
  // Feature 14b: PTY Interactive Terminal I/O
  | { type: 'pty_connect'; ptyId: string; projectPath?: string }
  | { type: 'pty_disconnect'; ptyId: string }
  | { type: 'pty_input'; ptyId: string; data: string }
  | { type: 'pty_resize'; ptyId: string; rows: number; cols: number; projectPath?: string }
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
  // Feature 22: Instance Disposal (Clear project context)
  | { type: 'dispose_instance'; projectPath?: string }
  | { type: 'get_agents_status' }
  // Claude Code-specific messages
  | { type: 'cc_list_projects' }
  | { type: 'cc_list_sessions'; cwd?: string }
  | { type: 'cc_get_session'; sessionId: string; cwd?: string }
  | { type: 'cc_get_session_messages'; sessionId: string; cwd?: string; limit?: number }
  | { type: 'cc_create_session'; cwd: string; model?: string }
  | { type: 'cc_delete_session'; sessionId: string; cwd?: string }
  | { type: 'cc_fork_session'; sessionId: string; messageId?: string; cwd?: string }
  | { type: 'cc_chat'; sessionId?: string; prompt: string; cwd?: string; model?: string; permissionMode?: ClaudeCodePermissionMode; allowedTools?: string[]; disallowedTools?: string[]; maxThinkingTokens?: number | null; systemPrompt?: ClaudeCodeSystemPrompt; activeSubagent?: string }
  | { type: 'cc_abort'; sessionId: string }
  | { type: 'cc_permission_response'; sessionId: string; toolUseId: string; response: PermissionResponse }
  | { type: 'cc_list_skills'; cwd?: string }
  | { type: 'cc_list_hooks'; cwd?: string }
  | { type: 'cc_list_commands'; cwd?: string }
  | { type: 'cc_get_config'; cwd?: string }
  | { type: 'cc_set_config'; config: Partial<ClaudeCodeConfig>; cwd?: string }
  // Claude Code File Checkpointing (Undo/Revert)
  | { type: 'cc_rewind_checkpoint'; sessionId: string; checkpointUuid: string; cwd: string }
  // Claude Code Custom Tools
  | { type: 'cc_list_custom_tools' }
  | { type: 'cc_get_custom_tool'; id: string }
  | { type: 'cc_save_custom_tool'; tool: ClaudeCodeCustomTool }
  | { type: 'cc_delete_custom_tool'; id: string }
  | { type: 'cc_test_custom_tool'; tool: ClaudeCodeCustomTool; testArgs: Record<string, unknown> }
  // Claude Code Plugins
  | { type: 'cc_list_plugins'; cwd?: string }
  | { type: 'cc_get_plugin'; name: string }
  | { type: 'cc_toggle_plugin'; name: string; enabled: boolean }
  | { type: 'cc_add_plugin_path'; path: string }
  | { type: 'cc_remove_plugin_path'; path: string }
  | { type: 'cc_get_plugin_config' }
  | { type: 'cc_reload_plugins'; cwd?: string }
  // Artifact Index (SQLite)
  | { type: 'artifacts_search'; text?: string; filters?: ArtifactSearchFilters; limit?: number; offset?: number }
  | { type: 'artifacts_get'; id: string }
  | { type: 'artifacts_update'; id: string; userTags?: string[]; starred?: boolean; notes?: string | null }
  | { type: 'artifacts_get_config' }
  | { type: 'artifacts_set_config'; config: Partial<ArtifactsConfig> }
  | { type: 'artifacts_clear' }
  | { type: 'artifacts_stats' }
  | { type: 'artifacts_enrich_now' }
  // Subscription Usage Tracking
  | { type: 'get_subscription_usage' }
  | { type: 'get_provider_usage'; providerId: 'claude' | 'openai' }

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
  | { type: 'sdk_event_batch'; data: unknown[] }
  | { type: 'ping'; data: { id: string; sentAt: number } }
  | { type: 'client_pong'; id: string; sentAt: number; receivedAt: number }
  | { type: 'connection_metrics'; data: { rttMs: number; lastPongAt: number; connectionType?: string } }
  | { type: 'opencode_restarted'; data: boolean; requestId?: string }
  | { type: 'status'; data: { opencodeRunning: boolean } }
  | { type: 'error'; message: string; code?: string; requestId?: string }
  | { type: 'lsp_status'; data: LspServerStatus[]; requestId?: string }
  | { type: 'session_context'; data: SessionContextInfo; sessionId: string; requestId?: string }
  | { type: 'device_registered'; data: DeviceInfo; requestId?: string }
  | { type: 'devices'; data: DeviceInfo[]; requestId?: string }
  | { type: 'device_disconnected'; data: { deviceId: string; deviceName?: string }; requestId?: string }
  | { type: 'device_connected'; data: DeviceInfo }
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
  // Feature 21: Binary File Content
  | { type: 'file_binary'; data: FileBinaryContent; path: string; requestId?: string }
  | { type: 'file_too_large'; path: string; size: number; maxSize: number; requestId?: string }
  // Feature 12: File Search
  | { type: 'files_found'; data: string[]; requestId?: string }
  | { type: 'text_found'; data: TextSearchResult[]; requestId?: string }
  | { type: 'symbols_found'; data: SymbolResult[]; requestId?: string }
  | { type: 'files_and_dirs_found'; data: string[]; requestId?: string }
  // Feature 13: Session Status
  | { type: 'session_status'; data: Record<string, SessionStatusInfo>; requestId?: string }
  // Feature 14: PTY Terminal Sessions
  | { type: 'pty_list'; data: PtySession[]; requestId?: string }
  | { type: 'pty_created'; data: PtySession; requestId?: string }
  | { type: 'pty'; data: PtySession; requestId?: string }
  | { type: 'pty_updated'; data: PtySession; requestId?: string }
  | { type: 'pty_deleted'; data: boolean; ptyId: string; requestId?: string }
  | { type: 'pty_connected'; ptyId: string; requestId?: string }
  | { type: 'pty_disconnected'; ptyId: string; requestId?: string }
  | { type: 'pty_output'; ptyId: string; data: string }
  | { type: 'pty_exit'; ptyId: string; exitCode?: number }
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
  | { type: 'instance_disposed'; data: boolean; requestId?: string }
  | { type: 'agents_status'; data: Record<AgentType, AgentStatusInfo>; requestId?: string }
  | { type: 'cc_projects'; data: ProjectSummary[]; requestId?: string }
  | { type: 'cc_sessions'; data: ClaudeCodeSession[]; requestId?: string }
  | { type: 'cc_session'; data: ClaudeCodeSession; requestId?: string }
  | { type: 'cc_session_created'; data: ClaudeCodeSession; requestId?: string }
  | { type: 'cc_session_deleted'; data: boolean; sessionId: string; requestId?: string }
  | { type: 'cc_session_forked'; data: ClaudeCodeSession | null; requestId?: string }
  | { type: 'cc_session_messages'; data: ClaudeCodeTranscriptMessage[]; sessionId: string; requestId?: string }
  | { type: 'cc_skills'; data: ClaudeCodeSkill[]; requestId?: string }
  | { type: 'cc_hooks'; data: ClaudeCodeHook[]; requestId?: string }
  | { type: 'cc_commands'; data: ClaudeCodeCommand[]; requestId?: string }
  | { type: 'cc_config'; data: ClaudeCodeConfig; requestId?: string }
  | { type: 'cc_config_updated'; data: ClaudeCodeConfig; requestId?: string }
  | { type: 'cc_stream'; data: ClaudeCodeStreamMessage; sessionId: string }
  // Claude Code Custom Tools
  | { type: 'cc_custom_tools'; data: ClaudeCodeCustomTool[]; requestId?: string }
  | { type: 'cc_custom_tool'; data: ClaudeCodeCustomTool | null; requestId?: string }
  | { type: 'cc_custom_tool_saved'; data: ClaudeCodeCustomTool; requestId?: string }
  | { type: 'cc_custom_tool_deleted'; data: boolean; id: string; requestId?: string }
  | { type: 'cc_custom_tool_test_result'; data: { success: boolean; result?: string; error?: string }; requestId?: string }
  // Claude Code Plugins
  | { type: 'cc_plugins'; data: ClaudeCodePlugin[]; requestId?: string }
  | { type: 'cc_plugin'; data: ClaudeCodePlugin | null; requestId?: string }
  | { type: 'cc_plugin_toggled'; data: boolean; name: string; enabled: boolean; requestId?: string }
  | { type: 'cc_plugin_path_added'; data: boolean; path: string; requestId?: string }
  | { type: 'cc_plugin_path_removed'; data: boolean; path: string; requestId?: string }
  | { type: 'cc_plugin_config'; data: ClaudeCodePluginConfig; requestId?: string }
  | { type: 'cc_plugins_reloaded'; data: ClaudeCodePlugin[]; requestId?: string }
  // Artifact Index (SQLite)
  | { type: 'artifacts_results'; data: ArtifactSearchResult; requestId?: string }
  | { type: 'artifact'; data: Artifact | null; requestId?: string }
  | { type: 'artifact_updated'; data: boolean; id: string; requestId?: string }
  | { type: 'artifacts_config'; data: ArtifactsConfig; requestId?: string }
  | { type: 'artifacts_cleared'; data: boolean; requestId?: string }
  | { type: 'artifacts_stats'; data: ArtifactsStats; requestId?: string }
  | { type: 'artifacts_enrich_started'; data: boolean; requestId?: string }
  | { type: 'artifacts_enrichment'; data: ArtifactsEnrichmentEvent }
  // Subscription Usage Tracking
  | { type: 'subscription_usage'; data: SubscriptionUsage; requestId?: string }
  | { type: 'provider_usage'; data: ProviderUsage; requestId?: string }

export type {
  Artifact,
  ArtifactSearchFilters,
  ArtifactSearchQuery,
  ArtifactSearchResult,
  ArtifactsConfig,
  ArtifactsEnrichmentEvent,
  ArtifactsStats,
} from './artifacts/types'

// Feature 11: File Content
export type FileContent = {
  content: string
  mime: string
}

// Feature 21: Binary File Content (images, PDFs, etc.)
export type FileBinaryContent = {
  base64: string
  mime: string
  size: number
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

// NEW: Agent Status for multi-agent support
export type AgentStatusInfo = {
  available: boolean
  authMethod?: string
  version?: string
}

// ============================================================================
// CLAUDE CODE-SPECIFIC TYPES
// ============================================================================

// Claude Code Skill (auto-invoked capability)
export type ClaudeCodeSkill = {
  name: string
  description?: string
  autoInvoke: boolean
  tags?: string[]
  license?: string
}

// Claude Code Hook Event Types
export type ClaudeCodeHookEvent = 
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'Stop'
  | 'PermissionRequest'
  | 'UserPromptSubmit'

// Claude Code Hook Configuration
export type ClaudeCodeHook = {
  id: string
  event: ClaudeCodeHookEvent
  matcher?: string  // Tool name pattern (e.g., 'Bash', 'Write|Edit')
  enabled: boolean
  description?: string
}

// Claude Code Session (different from OpenCode session)
export type ClaudeCodeSession = {
  id: string
  title?: string
  cwd: string
  model?: string
  createdAt: number
  updatedAt: number
  messageCount?: number
}

// Claude Code Command (slash command)
export type ClaudeCodeCommand = {
  name: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

// Claude Code Permission Mode
export type ClaudeCodePermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export type ClaudeCodeSystemPrompt = 
  | string 
  | { type: 'preset'; preset: 'claude_code'; append?: string }
  | null

// Claude Code Subagent Definition (matches SDK AgentDefinition)
export type ClaudeCodeSubagent = {
  name: string                   // Unique identifier for the subagent
  description: string            // When Claude should use this subagent
  prompt: string                 // System prompt for the subagent
  tools?: string[]               // Allowed tools (inherits if omitted)
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'  // Model override
}

// Claude Code Custom Tool Parameter
export type ClaudeCodeCustomToolParameter = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  required?: boolean
  default?: unknown
  enum?: string[]  // For string types with fixed options
}

// Claude Code Custom Tool HTTP Handler Config
export type ClaudeCodeHttpHandlerConfig = {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  bodyTemplate?: string  // JSON template with {{param}} placeholders
}

// Claude Code Custom Tool Script Handler Config
export type ClaudeCodeScriptHandlerConfig = {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  shell?: boolean
}

// Claude Code Custom Tool Definition
export type ClaudeCodeCustomTool = {
  id: string
  name: string
  description: string
  parameters: ClaudeCodeCustomToolParameter[]
  handler: 'http' | 'script'
  handlerConfig: ClaudeCodeHttpHandlerConfig | ClaudeCodeScriptHandlerConfig
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// ============================================================================
// CLAUDE CODE PLUGIN TYPES
// ============================================================================

// Plugin manifest from plugin.json
export type ClaudeCodePluginManifest = {
  name: string
  version?: string
  description?: string
  author?: {
    name?: string
    email?: string
    url?: string
  }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}

// Plugin status
export type ClaudeCodePluginStatus = 'enabled' | 'disabled' | 'error'

// Full plugin definition
export type ClaudeCodePlugin = {
  name: string
  path: string                    // Absolute path to plugin directory
  status: ClaudeCodePluginStatus
  manifest?: ClaudeCodePluginManifest
  // Discovered components
  commands?: string[]             // Slash commands provided by plugin
  agents?: string[]               // Agent definitions
  skills?: string[]               // Skills provided
  hasHooks?: boolean              // Has hooks.json
  hasMcpServers?: boolean         // Has MCP server configs
  hasLspServers?: boolean         // Has LSP server configs
  // Runtime info
  loadedAt?: number               // When plugin was last loaded
  error?: string                  // Error message if status is 'error'
}

// Plugin configuration (what we store in ~/.broski/plugins-config.json)
export type ClaudeCodePluginConfig = {
  enabled: string[]               // Plugin names that are enabled
  disabled: string[]              // Plugin names that are explicitly disabled
  customPaths: string[]           // Additional plugin paths to scan
}

// Claude Code Configuration
export type ClaudeCodeConfig = {
  permissionMode: ClaudeCodePermissionMode
  allowedTools: string[]
  disallowedTools: string[]
  model?: string
  systemPrompt?: ClaudeCodeSystemPrompt
  subagents?: ClaudeCodeSubagent[]           // Custom subagent definitions
  activeSubagent?: string                     // Currently selected subagent name
}

// Claude Code Message (for streaming)
export type ClaudeCodeStreamMessage = 
  | { type: 'session-created'; sessionId: string; agent: 'claude-code'; model?: string }
  | { type: 'session-init'; sessionId: string; model: string; permissionMode: ClaudeCodePermissionMode; tools: string[]; slashCommands: string[]; skills: string[]; mcpServers: Array<{ name: string; status: string }>; plugins: Array<{ name: string; path: string }>; apiKeySource?: string; claudeCodeVersion?: string }
  | { type: 'permission-request'; sessionId: string; toolUseId: string; tool: string; input: Record<string, unknown>; decisionReason?: string; blockedPath?: string; hasSuggestions?: boolean }
  | { type: 'checkpoint-created'; sessionId: string; checkpointUuid: string; timestamp: number }
  | { type: 'assistant-message'; content: string }
  | { type: 'assistant-message-delta'; content: string }
  | { type: 'thinking-delta'; content: string; partId?: string }
  | { type: 'tool-call'; tool: string; input: any; toolUseId?: string; status: 'running' | 'completed' | 'failed' }
  | { type: 'tool-result'; toolUseId?: string; result: any; toolUseResult?: any }
  | { type: 'subagent-invocation'; subagentName: string; toolUseId?: string; prompt?: string; description?: string }
  | { type: 'token-usage'; usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } }
  | { type: 'error'; message: string; code?: string }

export type ClaudeCodeTranscriptToolCall = {
  toolUseId: string
  tool: string
  input?: any
  status: 'running' | 'completed' | 'failed'
  output?: string
  metadata?: Record<string, unknown>
}

export type ClaudeCodeTranscriptDiff = {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  diff?: string
  partId?: string
}

export type ClaudeCodeTranscriptMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  createdAt: number
  text: string
  thinking?: string
  toolCalls?: ClaudeCodeTranscriptToolCall[]
  diffs?: ClaudeCodeTranscriptDiff[]
}

// Feature 21: File Attachment (for @ tagging in prompt and image attachments)
export type FileAttachment = {
  path: string
  isDirectory: boolean
  // Image support fields (Phase 4)
  mimeType?: string      // e.g., "image/png", "image/jpeg"
  base64Data?: string    // Base64 encoded image data from mobile
}

// ============================================================================
// SUBSCRIPTION USAGE TYPES
// ============================================================================

export type UsageWindow = {
  usedPercent: number       // 0-100
  resetsAt: number | null   // Unix timestamp (seconds)
  windowSeconds: number     // Window duration in seconds
}

export type ExtraUsage = {
  isEnabled: boolean
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null  // 0-100
  currency: string
  resetsAt: number | null
}

export type Credits = {
  hasCredits: boolean
  unlimited: boolean
  balance: number | null
}

export type ProviderUsage = {
  providerId: 'claude' | 'openai'
  providerName: string
  plan: string | null
  sessionWindow: UsageWindow | null
  weeklyWindow: UsageWindow | null
  weeklyOpusWindow: UsageWindow | null
  weeklySonnetWindow: UsageWindow | null
  extraUsage: ExtraUsage | null
  credits: Credits | null
  source: string
  fetchedAt: number
  error: string | null
}

export type SubscriptionUsage = {
  providers: ProviderUsage[]
  fetchedAt: number
}
