import type {
  Artifact,
  ArtifactSearchFilters,
  ArtifactSearchQuery,
  ArtifactSearchResult,
  ArtifactsConfig,
  ArtifactsEnrichmentEvent,
  ArtifactsStats,
} from './artifacts/types'

export type PermissionResponse = 'once' | 'always' | 'reject' | 'execpolicy'

// Session permission rules (OpenCode SDK v1.1.1+)
export type PermissionAction = 'allow' | 'deny' | 'ask'

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRuleset = Array<PermissionRule>

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
export type AgentType = 'opencode' | 'claude-code' | 'codex'

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
  | { type: 'set_view'; projectPath?: string; sessionId?: string; agent?: AgentType }
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
  | { type: 'get_config'; projectPath?: string }
  | { type: 'set_config'; config: Record<string, any>; projectPath?: string }
  | { type: 'set_model'; model: string }
  | { type: 'create_session'; projectPath?: string; title?: string; permission?: PermissionRuleset }
  | { type: 'get_session'; sessionId: string; projectPath?: string }
  | { type: 'get_session_messages'; sessionId: string; projectPath?: string; limit?: number }
  | { type: 'chat'; sessionId: string; content: string; projectPath?: string; messageId?: string; model?: { providerID: string; modelID: string }; agent?: string; disabledTools?: string[]; fileAttachments?: FileAttachment[] }
  | { type: 'abort'; sessionId: string; projectPath?: string }
  | { type: 'diff'; sessionId: string; projectPath?: string; messageId?: string }
  | { type: 'browse'; path: string; projectPath?: string }
  | { type: 'permission_response'; sessionId: string; permissionId: string; response: PermissionResponse; message?: string; projectPath?: string }
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
  | { type: 'get_mcp_resources'; projectPath?: string }
  // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
  | { type: 'list_worktrees'; projectPath?: string }
  | { type: 'create_worktree'; name?: string; startCommand?: string; projectPath?: string }
  | { type: 'delete_worktree'; name: string; projectPath?: string }
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
  // Skills (filesystem-backed)
  | { type: 'oc_list_skills'; cwd?: string }
  | { type: 'oc_get_skill'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_save_skill'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'oc_delete_skill'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_list_plugin_files'; cwd?: string }
  | { type: 'oc_get_plugin_file'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_save_plugin_file'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'oc_delete_plugin_file'; name: string; source: 'project' | 'user'; cwd?: string }
  // OpenCode custom markdown files (filesystem-backed)
  | { type: 'oc_list_command_files'; cwd?: string }
  | { type: 'oc_get_command_file'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_save_command_file'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'oc_delete_command_file'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_list_agent_files'; cwd?: string }
  | { type: 'oc_get_agent_file'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'oc_save_agent_file'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'oc_delete_agent_file'; name: string; source: 'project' | 'user'; cwd?: string }
  // OpenCode Question Tool
  | { type: 'oc_question_reply'; questionId: string; answers: string[][]; projectPath?: string }
  | { type: 'oc_question_reject'; questionId: string; projectPath?: string }
  // Claude Code-specific messages
  | { type: 'cc_list_projects' }
  | { type: 'cc_list_sessions'; cwd?: string }
  | { type: 'cc_get_session'; sessionId: string; cwd?: string }
  | { type: 'cc_get_session_messages'; sessionId: string; cwd?: string; limit?: number }
  | { type: 'cc_create_session'; cwd: string; model?: string }
  | { type: 'cc_delete_session'; sessionId: string; cwd?: string }
  | { type: 'cc_fork_session'; sessionId: string; messageId?: string; cwd?: string }
  | { type: 'cc_chat'; sessionId?: string; prompt: string; cwd?: string; model?: string; permissionMode?: ClaudeCodePermissionMode; allowedTools?: string[]; disallowedTools?: string[]; maxThinkingTokens?: number | null; variant?: string; systemPrompt?: ClaudeCodeSystemPrompt; activeSubagent?: string; fileAttachments?: FileAttachment[] }
  | { type: 'cc_abort'; sessionId: string }
  | { type: 'cc_permission_response'; sessionId: string; toolUseId: string; response: PermissionResponse }
  | { type: 'cc_list_skills'; cwd?: string }
  | { type: 'cc_get_skill'; name: string; source: 'project' | 'user' | 'plugin'; cwd?: string; path?: string }
  | { type: 'cc_save_skill'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'cc_delete_skill'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'cc_list_hooks'; cwd?: string }
  | { type: 'cc_hooks_file_read'; source: 'project' | 'user'; cwd?: string }
  | { type: 'cc_hooks_file_write'; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'cc_mcp_file_read'; cwd: string }
  | { type: 'cc_mcp_file_write'; cwd: string; content: string }
  | { type: 'cc_list_commands'; cwd?: string }
  | { type: 'cc_get_command'; name: string; source: 'project' | 'user' | 'plugin'; cwd?: string; path?: string }
  | { type: 'cc_save_command'; name: string; source: 'project' | 'user'; content: string; cwd?: string }
  | { type: 'cc_delete_command'; name: string; source: 'project' | 'user'; cwd?: string }
  | { type: 'cc_get_config'; cwd?: string }
  | { type: 'cc_set_config'; config: Partial<ClaudeCodeConfig>; cwd?: string }
  | { type: 'cc_get_active_sessions' }
  // Codex (OpenAI Codex app-server) messages
  | { type: 'cx_list_projects'; refresh?: boolean }
  | { type: 'cx_list_threads'; cwd?: string; cursor?: string | null; limit?: number | null; refresh?: boolean }
  | { type: 'cx_warmup' }
  | { type: 'cx_start_thread'; cwd?: string; model?: string; approvalPolicy?: string; sandbox?: string; env?: Record<string, string> }
  | { type: 'cx_resume_thread'; threadId: string }
  | { type: 'cx_archive_thread'; threadId: string }
  | { type: 'cx_get_thread_messages'; threadId: string }
  | { type: 'cx_chat'; threadId?: string; prompt: string; cwd?: string; model?: string; effort?: string; summary?: string; approvalPolicy?: string; sandbox?: string; sandboxPolicy?: any; config?: Record<string, any>; env?: Record<string, string>; baseInstructions?: string; developerInstructions?: string; fileAttachments?: FileAttachment[]; collaborationMode?: 'plan' | 'pairprogramming' | 'execute' }
  | { type: 'cx_abort'; threadId: string; turnId?: string }
  | { type: 'cx_permission_response'; requestId: string; response: PermissionResponse; execpolicyAmendment?: any }
  // Codex request_user_input response (SDK v0.87.0+)
  | { type: 'cx_user_input_response'; requestId: string; answers: Record<string, { selected: string[]; other?: string }> }
  | { type: 'cx_thread_fork'; threadId: string }
  | { type: 'cx_thread_rollback'; threadId: string; numTurns: number }
  | { type: 'cx_model_list' }
  | { type: 'cx_skills_list'; cwd?: string; forceReload?: boolean }
  | { type: 'cx_get_skill'; name: string; scope: 'Repo' | 'User' | 'System' | 'Admin'; cwd?: string }
  | { type: 'cx_save_skill'; name: string; scope: 'Repo' | 'User'; content: string; cwd?: string }
  | { type: 'cx_delete_skill'; name: string; scope: 'Repo' | 'User'; cwd?: string }
  | { type: 'cx_config_read' }
  | { type: 'cx_config_value_write'; keyPath: string; value: any; mergeStrategy?: string }
  | { type: 'cx_mcp_status_list'; cursor?: string | null; limit?: number | null }
  | { type: 'cx_mcp_oauth_login'; name: string; scopes?: string[]; timeoutSecs?: number }
  | { type: 'cx_review_start'; threadId?: string; cwd?: string; delivery?: 'inline' | 'detached'; target?: any; model?: string; approvalPolicy?: string; sandbox?: string; sandboxPolicy?: any; config?: Record<string, any> }
  | { type: 'cx_account_read'; refreshToken?: boolean }
  | { type: 'cx_login_start'; loginType: 'chatgpt' | 'apiKey'; apiKey?: string }
  | { type: 'cx_login_cancel'; loginId: string }
  | { type: 'cx_logout' }
  | { type: 'cx_rate_limits_read' }
  | { type: 'cx_feedback_upload'; classification: string; reason?: string | null; threadId?: string | null; includeLogs?: boolean }
  | { type: 'cx_undo_files'; threadId: string; count?: number }
  | { type: 'cx_agents_read'; cwd: string }
  | { type: 'cx_agents_write'; cwd: string; content: string }
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
  | { type: 'oc_question_replied'; data: boolean; requestId?: string }
  | { type: 'oc_question_rejected'; data: boolean; requestId?: string }
  // Skills (filesystem-backed)
  | { type: 'oc_skills'; data: Array<{ name: string; description?: string; path: string; source: 'project' | 'user'; editable: boolean }>; requestId?: string }
  | { type: 'oc_skill'; data: { name: string; path: string; source: 'project' | 'user'; content: string }; requestId?: string }
  | { type: 'oc_skill_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'oc_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'oc_plugin_files'; data: Array<{ name: string; path: string; source: 'project' | 'user' }>; requestId?: string }
  | { type: 'oc_plugin_file'; data: { name: string; path: string; source: 'project' | 'user'; content: string }; requestId?: string }
  | { type: 'oc_plugin_file_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'oc_plugin_file_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'oc_command_files'; data: Array<{ name: string; path: string; source: 'project' | 'user'; description?: string }>; requestId?: string }
  | { type: 'oc_command_file'; data: { name: string; path: string; source: 'project' | 'user'; content: string }; requestId?: string }
  | { type: 'oc_command_file_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'oc_command_file_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'oc_agent_files'; data: Array<{ name: string; path: string; source: 'project' | 'user'; description?: string }>; requestId?: string }
  | { type: 'oc_agent_file'; data: { name: string; path: string; source: 'project' | 'user'; content: string }; requestId?: string }
  | { type: 'oc_agent_file_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'oc_agent_file_deleted'; data: { ok: boolean }; requestId?: string }
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
  | { type: 'pty_error'; ptyId: string; error: string }
  | {
      type: 'pty_health'
      ptyId: string
      lastInputTime: number
      lastOutputTime: number
      bytesIn: number
      bytesOut: number
      isResponsive: boolean
    }
  | { type: 'pty_exit'; ptyId: string; exitCode?: number }
  // Feature 15: MCP Server Management
  | { type: 'mcp_status'; data: Record<string, McpServerStatus>; requestId?: string }
  | { type: 'mcp_connected'; data: boolean; name: string; requestId?: string }
  | { type: 'mcp_disconnected'; data: boolean; name: string; requestId?: string }
  | { type: 'mcp_resources'; data: Record<string, McpResource>; requestId?: string }
  // Feature 23: Git Worktrees
  | { type: 'worktrees'; data: Worktree[]; requestId?: string }
  | { type: 'worktree_created'; data: Worktree; requestId?: string }
  | { type: 'worktree_deleted'; data: boolean; name: string; requestId?: string }
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
  | { type: 'cc_skill'; data: { name: string; path: string; source: 'project' | 'user' | 'plugin'; content: string }; requestId?: string }
  | { type: 'cc_skill_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'cc_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'cc_hooks'; data: ClaudeCodeHook[]; requestId?: string }
  | { type: 'cc_hooks_file'; data: { ok: boolean; source: 'project' | 'user'; path: string; content: string }; requestId?: string }
  | { type: 'cc_hooks_file_written'; data: { ok: boolean; source: 'project' | 'user'; path: string }; requestId?: string }
  | { type: 'cc_mcp_file'; data: { ok: boolean; path: string; content: string }; requestId?: string }
  | { type: 'cc_mcp_file_written'; data: { ok: boolean; path: string }; requestId?: string }
  | { type: 'cc_commands'; data: ClaudeCodeCommand[]; requestId?: string }
  | { type: 'cc_command_file'; data: { ok: boolean; name: string; source: 'project' | 'user' | 'plugin'; path: string; content: string }; requestId?: string }
  | { type: 'cc_command_saved'; data: { ok: boolean; name: string; source: 'project' | 'user'; path?: string }; requestId?: string }
  | { type: 'cc_command_deleted'; data: { ok: boolean; name: string; source: 'project' | 'user' }; requestId?: string }
  | { type: 'cc_config'; data: ClaudeCodeConfig; requestId?: string }
  | { type: 'cc_config_updated'; data: ClaudeCodeConfig; requestId?: string }
  | { type: 'cc_fs_changed'; data: { kind: 'skills' | 'plugins' | 'hooks' | 'commands' | 'mcp'; dir: string; cwd?: string; file?: string }; requestId?: string }
  | { type: 'cc_stream'; data: ClaudeCodeStreamMessage; sessionId: string }
  // Codex (OpenAI Codex app-server)
  | { type: 'cx_global'; data: { method: string; params?: any }; requestId?: string }
  | { type: 'cx_projects'; data: ProjectSummary[]; requestId?: string }
  | { type: 'cx_warmup_started'; requestId?: string }
  | { type: 'cx_threads'; data: CodexThread[]; nextCursor?: string | null; requestId?: string }
  | { type: 'cx_models'; data: any; nextCursor?: string | null; requestId?: string }
  | { type: 'cx_thread'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_created'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_forked'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_rolled_back'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_archived'; data: boolean; threadId: string; requestId?: string }
  | { type: 'cx_thread_messages'; data: CodexTranscriptMessage[]; threadId: string; requestId?: string }
  | { type: 'cx_skills'; data: any; requestId?: string }
  | { type: 'cx_skill'; data: { name: string; path: string; scope: 'Repo' | 'User' | 'System' | 'Admin'; content: string }; requestId?: string }
  | { type: 'cx_skill_saved'; data: { ok: boolean; path?: string }; requestId?: string }
  | { type: 'cx_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'cx_config'; data: any; requestId?: string }
  | { type: 'cx_config_written'; data: any; requestId?: string }
  | { type: 'cx_mcp_status'; data: any; nextCursor?: string | null; requestId?: string }
  | { type: 'cx_mcp_oauth'; data: any; requestId?: string }
  | { type: 'cx_review_started'; data: { threadId: string; reviewThreadId: string; turnId: string }; requestId?: string }
  | { type: 'cx_account'; data: any; requestId?: string }
  | { type: 'cx_login_started'; data: any; requestId?: string }
  | { type: 'cx_login_canceled'; data: any; requestId?: string }
  | { type: 'cx_logged_out'; data: any; requestId?: string }
  | { type: 'cx_rate_limits'; data: any; requestId?: string }
  | { type: 'cx_feedback_uploaded'; data: any; requestId?: string }
  | { type: 'cx_undo_result'; data: { ok: boolean; revertedPaths: string[]; error?: string }; requestId?: string }
  | { type: 'cx_agents'; data: { exists: boolean; path: string; content: string }; requestId?: string }
  | { type: 'cx_agents_written'; data: { ok: boolean; path: string }; requestId?: string }
  | { type: 'cx_stream'; data: CodexStreamMessage; threadId: string }
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

// MCP Resource (SDK v1.1.1+ experimental feature)
export type McpResource = {
  name: string
  uri: string
  description?: string
  mimeType?: string
  client: string  // Which MCP server provides this resource
}

// Git Worktree (SDK v1.1.1+ experimental feature)
export type Worktree = {
  name: string
  branch: string
  directory: string
}

export type WorktreeCreateInput = {
  name?: string
  startCommand?: string
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
  source?: 'project' | 'user' | 'plugin'
  path?: string
}

// Claude Code Hook Event Types
export type ClaudeCodeHookEvent = 
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'PermissionRequest'
  | 'UserPromptSubmit'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'

// Claude Code Hook Configuration
export type ClaudeCodeHook = {
  id: string
  event: ClaudeCodeHookEvent
  matcher?: string  // Tool name pattern (e.g., 'Bash', 'Write|Edit')
  enabled: boolean
  description?: string
  hooks?: any[]
  source?: 'project' | 'user' | 'plugin'
  path?: string
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
  source?: 'project' | 'user' | 'plugin'
  path?: string
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
  // Project/user settings (persisted in Claude Code settings.json)
  language?: string
  releaseChannel?: 'stable' | 'latest'
  respectGitignore?: boolean
  subagents?: ClaudeCodeSubagent[]           // Custom subagent definitions
  activeSubagent?: string                     // Currently selected subagent name
}

// Claude Code Message (for streaming)
export type ClaudeCodeStreamMessage = 
  | { type: 'session-created'; sessionId: string; agent: 'claude-code'; model?: string }
  | { type: 'session-init'; sessionId: string; model: string; permissionMode: ClaudeCodePermissionMode; tools: string[]; slashCommands: string[]; skills: string[]; mcpServers: Array<{ name: string; status: string }>; plugins: Array<{ name: string; path: string }>; apiKeySource?: string; claudeCodeVersion?: string }
  | { type: 'permission-request'; sessionId: string; toolUseId: string; tool: string; input: Record<string, unknown>; decisionReason?: string; blockedPath?: string; hasSuggestions?: boolean }
  | { type: 'checkpoint-created'; sessionId: string; checkpointUuid: string; timestamp: number }
  | { type: 'assistant-message'; content: string; messageId?: string }
  | { type: 'assistant-message-delta'; content: string; messageId?: string }
  | { type: 'thinking-delta'; content: string; partId?: string; messageId?: string }
  | { type: 'tool-call'; tool: string; input: any; toolUseId?: string; status: 'running' | 'completed' | 'failed'; messageId?: string }
  | { type: 'tool-result'; toolUseId?: string; result: any; toolUseResult?: any; messageId?: string }
  | { type: 'subagent-invocation'; subagentName: string; toolUseId?: string; prompt?: string; description?: string; messageId?: string }
  | { type: 'token-usage'; usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }; messageId?: string }
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

// ============================================================================
// CODEX (OpenAI Codex app-server) TYPES
// ============================================================================

export type CodexThread = {
  id: string
  preview: string
  modelProvider?: string
  createdAt: number // Unix timestamp seconds
  updatedAt: number // Unix timestamp seconds (SDK v0.87.0+)
  cwd: string
  cliVersion?: string
  source?: string
  gitInfo?: { branch?: string } | null
}

export type CodexTranscriptToolCall = {
  itemId: string
  type: 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'webSearch' | 'imageView' | 'review'
  name: string
  status: 'running' | 'completed' | 'failed' | 'declined'
  input?: any
  output?: string
  metadata?: Record<string, unknown>
}

export type CodexTranscriptDiff = {
  file: string
  diff: string
  additions: number
  deletions: number
  itemId?: string
}

export type CodexTranscriptMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  createdAt: number
  text: string
  thinking?: string
  toolCalls?: CodexTranscriptToolCall[]
  diffs?: CodexTranscriptDiff[]
}

export type CodexStreamMessage =
  | { type: 'notification'; method: string; params: any }
  | { type: 'request'; requestId: string; method: string; params: any }
  | { type: 'error'; message: string; code?: string; details?: any; modelCapModel?: string; modelCapRetrySeconds?: number }
  // Multi-Agent Collaboration Events (Codex SDK v0.87.0+)
  | { type: 'collab_spawn_begin'; data: CodexCollabAgentSpawnBeginEvent }
  | { type: 'collab_spawn_end'; data: CodexCollabAgentSpawnEndEvent }
  | { type: 'collab_interaction_begin'; data: CodexCollabAgentInteractionBeginEvent }
  | { type: 'collab_interaction_end'; data: CodexCollabAgentInteractionEndEvent }
  | { type: 'collab_waiting_begin'; data: CodexCollabWaitingBeginEvent }
  | { type: 'collab_waiting_end'; data: CodexCollabWaitingEndEvent }
  | { type: 'collab_close_begin'; data: CodexCollabCloseBeginEvent }
  | { type: 'collab_close_end'; data: CodexCollabCloseEndEvent }

// ============================================================================
// CODEX MULTI-AGENT COLLABORATION TYPES (SDK v0.87.0+)
// ============================================================================

/** Agent status for multi-agent collaboration */
export type CodexAgentStatus =
  | { type: 'pending_init' }
  | { type: 'running' }
  | { type: 'completed'; message?: string }
  | { type: 'errored'; error: string }
  | { type: 'shutdown' }
  | { type: 'not_found' }

/** Event: Agent spawn started */
export type CodexCollabAgentSpawnBeginEvent = {
  callId: string
  senderThreadId: string
  prompt: string
}

/** Event: Agent spawn completed */
export type CodexCollabAgentSpawnEndEvent = {
  callId: string
  senderThreadId: string
  newThreadId?: string
  prompt: string
  status: CodexAgentStatus
}

/** Event: Agent-to-agent interaction started */
export type CodexCollabAgentInteractionBeginEvent = {
  callId: string
  senderThreadId: string
  receiverThreadId: string
  prompt: string
}

/** Event: Agent-to-agent interaction completed */
export type CodexCollabAgentInteractionEndEvent = {
  callId: string
  senderThreadId: string
  receiverThreadId: string
  prompt: string
  status: CodexAgentStatus
}

/** Event: Waiting for multiple agents started */
export type CodexCollabWaitingBeginEvent = {
  senderThreadId: string
  receiverThreadIds: string[]
  callId: string
}

/** Event: Waiting for multiple agents completed */
export type CodexCollabWaitingEndEvent = {
  senderThreadId: string
  callId: string
  statuses: Record<string, CodexAgentStatus>
}

/** Event: Agent close started */
export type CodexCollabCloseBeginEvent = {
  callId: string
  senderThreadId: string
  receiverThreadId: string
}

/** Event: Agent close completed */
export type CodexCollabCloseEndEvent = {
  callId: string
  senderThreadId: string
  receiverThreadId: string
  status: CodexAgentStatus
}

/** WebSearchMode replaces webSearchEnabled boolean (SDK v0.87.0+) */
export type CodexWebSearchMode = 'disabled' | 'cached' | 'live'

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
