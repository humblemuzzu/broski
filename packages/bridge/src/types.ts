import type { CodexAgentStatus, CodexAppInfo, CodexCollabAgentInteractionBeginEvent, CodexCollabAgentInteractionEndEvent, CodexCollabAgentSpawnBeginEvent, CodexCollabAgentSpawnEndEvent, CodexCollabCloseBeginEvent, CodexCollabCloseEndEvent, CodexCollabResumeBeginEvent, CodexCollabResumeEndEvent, CodexCollabWaitingBeginEvent, CodexCollabWaitingEndEvent, CodexModeKind, CodexPersonality, CodexPrompt, CodexRemoteSkill, CodexStreamMessage, CodexThread, CodexTranscriptDiff, CodexTranscriptMessage, CodexTranscriptToolCall, CodexWebSearchMode } from './types/codex'
import type { PiCommandPayload, PiForkMessagePayload, PiModelPayload, PiSessionInfo, PiStatePayload, PiStreamMessage } from './types/pi'

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
// Note: SDK v1.2.1 removed `id` field. Bridge no longer sends it.
// Flutter generates a local id from content.hashCode for widget keys.
export type Todo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

// Slash command from OpenCode SDK
// See: https://opencode.ai/docs/commands
export type CommandSource = 'command' | 'mcp' | 'skill'

export type Command = {
  name: string
  description?: string
  source?: CommandSource
  agent?: string // Specific agent to use (e.g., "build", "plan")
  model?: string // Specific model to use (e.g., "anthropic/claude-sonnet-4")
  template?: string // Command template
  subtask?: boolean // Run as background subtask
  hints: string[] // Autocomplete hints
}

export type AgentModelRef = {
  modelID: string
  providerID: string
}

// Agent from OpenCode SDK
export type Agent = {
  name: string
  description?: string
  color?: string
  mode: 'primary' | 'subagent' | 'all'
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  permission?: PermissionRuleset
  model?: AgentModelRef
  variant?: string
  prompt?: string
  options?: Record<string, unknown>
  steps?: number
}

// Agent type for multi-agent support
export type AgentType = 'opencode' | 'claude-code' | 'codex' | 'pi'

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
  | {
      type: 'batch'
      messages: Array<ClientMessage & { requestId?: string }>
      count?: number
      timestamp?: number
    }
  // Cloud auth (Convex session) used for licensing/entitlements.
  | { type: 'auth_session'; sessionToken: string; requestId?: string }
  | {
      type: 'set_view'
      projectPath?: string
      sessionId?: string
      agent?: AgentType
    }
  | { type: 'set_agent'; agent: AgentType }
  | { type: 'restart_opencode' }
  | { type: 'pong'; id: string; sentAt: number }
  // Client-initiated ping (for app lifecycle detection)
  | { type: 'client_ping'; id: string; sentAt: number }
  // Multi-device support
  | {
      type: 'register_device'
      deviceId: string
      deviceName: string
      platform: string
      protocolVersion?: string
    }
  | { type: 'list_devices' }
  | { type: 'disconnect_device'; deviceId: string }
  | { type: 'list_projects' }
  | {
      type: 'list_sessions'
      projectPath?: string
      roots?: boolean
      start?: number
      cursor?: number
      search?: string
      limit?: number
      archived?: boolean
    }
  | { type: 'list_providers' }
  | { type: 'get_config'; projectPath?: string }
  | { type: 'set_config'; config: Record<string, any>; projectPath?: string }
  | { type: 'set_model'; model: string; projectPath?: string }
  | {
      type: 'create_session'
      projectPath?: string
      title?: string
      permission?: PermissionRuleset
    }
  | { type: 'get_session'; sessionId: string; projectPath?: string }
  | {
      type: 'get_session_messages'
      sessionId: string
      projectPath?: string
      limit?: number
    }
  | {
      type: 'chat'
      sessionId: string
      content: string
      projectPath?: string
      messageId?: string
      model?: { providerID: string; modelID: string }
      agent?: string
      fileAttachments?: FileAttachment[]
      variant?: string
      noReply?: boolean
      system?: string
    }
  | { type: 'abort'; sessionId: string; projectPath?: string }
  | {
      type: 'diff'
      sessionId: string
      projectPath?: string
      messageId?: string
    }
  | { type: 'browse'; path: string; projectPath?: string }
  | {
      type: 'permission_response'
      sessionId: string
      permissionId: string
      response: PermissionResponse
      message?: string
      projectPath?: string
    }
  | { type: 'list_pending_permissions'; projectPath?: string }
  | { type: 'list_pending_questions'; projectPath?: string }
  | { type: 'get_lsp_status'; projectPath?: string }
  | { type: 'get_session_context'; sessionId: string; projectPath?: string }
  // Feature 1: Todo/Plan Management
  | { type: 'get_todos'; sessionId: string; projectPath?: string }
  // Feature 2: Slash Commands
  | { type: 'list_commands'; projectPath?: string }
  | {
      type: 'execute_command'
      sessionId: string
      command: string
      arguments: string
      projectPath?: string
      agent?: string
      model?: string
      variant?: string
      parts?: Array<{
        id?: string
        type: 'file'
        mime: string
        filename?: string
        url: string
        source?: Record<string, unknown>
      }>
    }
  // Feature 3: Agent Switching
  | { type: 'list_agents'; projectPath?: string }
  // Feature 4: Session Delete
  | { type: 'delete_session'; sessionId: string; projectPath?: string }
  // Feature 5: Session Update (Rename)
  | {
      type: 'update_session'
      sessionId: string
      title?: string
      archived?: boolean
      projectPath?: string
    }
  // Feature 6: Session Fork
  | {
      type: 'fork_session'
      sessionId: string
      messageId?: string
      projectPath?: string
    }
  | { type: 'session_children'; sessionId: string; projectPath?: string }
  // Feature 7: Message Revert (Undo)
  | {
      type: 'revert_message'
      sessionId: string
      messageId: string
      partId?: string
      projectPath?: string
    }
  | { type: 'unrevert_session'; sessionId: string; projectPath?: string }
  // Feature 8: Session Share
  | { type: 'share_session'; sessionId: string; projectPath?: string }
  | { type: 'unshare_session'; sessionId: string; projectPath?: string }
  // Feature 9: Session Summarize (Compact)
  | {
      type: 'summarize_session'
      sessionId: string
      providerID: string
      modelID: string
      projectPath?: string
      auto?: boolean
    }
  // Feature 10: Git/VCS Information
  | { type: 'get_vcs'; projectPath?: string }
  // Feature 11: File Content Read
  | { type: 'read_file'; path: string; projectPath?: string }
  // Feature 21: Binary File Content Read (images, PDFs, etc.)
  | { type: 'read_file_binary'; path: string; maxSizeMb?: number }
  // Feature 12: File Search
  | { type: 'find_files'; query: string; projectPath?: string }
  | {
      type: 'find_text'
      pattern: string
      include?: string
      projectPath?: string
    }
  | { type: 'find_symbols'; query: string; projectPath?: string }
  | { type: 'search_files_and_dirs'; query: string; projectPath?: string }
  // Feature 13: Session Status
  | { type: 'get_session_status'; projectPath?: string }
  // Feature 14: PTY Terminal Sessions
  | { type: 'list_pty'; projectPath?: string }
  | {
      type: 'create_pty'
      command?: string
      args?: string[]
      cwd?: string
      title?: string
      env?: Record<string, string>
      projectPath?: string
    }
  | { type: 'get_pty'; ptyId: string; projectPath?: string }
  | {
      type: 'update_pty'
      ptyId: string
      title?: string
      rows?: number
      cols?: number
      projectPath?: string
    }
  | { type: 'delete_pty'; ptyId: string; projectPath?: string }
  // Feature 14b: PTY Interactive Terminal I/O
  | { type: 'pty_connect'; ptyId: string; projectPath?: string }
  | { type: 'pty_disconnect'; ptyId: string }
  | { type: 'pty_input'; ptyId: string; data: string }
  | {
      type: 'pty_resize'
      ptyId: string
      rows: number
      cols: number
      projectPath?: string
    }
  // Feature 15: MCP Server Management
  | { type: 'get_mcp_status'; projectPath?: string }
  | {
      type: 'add_mcp'
      name: string
      config: Record<string, unknown>
      projectPath?: string
    }
  | { type: 'connect_mcp'; name: string; projectPath?: string }
  | { type: 'disconnect_mcp'; name: string; projectPath?: string }
  | { type: 'get_mcp_resources'; projectPath?: string }
  // MCP OAuth Authentication
  | { type: 'mcp_auth_start'; name: string; projectPath?: string }
  | {
      type: 'mcp_auth_callback'
      name: string
      code: string
      projectPath?: string
    }
  | { type: 'mcp_auth_authenticate'; name: string; projectPath?: string }
  | { type: 'mcp_auth_remove'; name: string; projectPath?: string }
  // Provider credential management
  | {
      type: 'auth_set'
      providerId: string
      auth: Record<string, unknown>
      projectPath?: string
    }
  | { type: 'auth_remove'; providerId: string; projectPath?: string }
  // Global config
  | { type: 'get_global_config' }
  | { type: 'set_global_config'; config: Record<string, unknown> }
  // Project management
  | { type: 'get_current_project'; projectPath?: string }
  | {
      type: 'update_project'
      projectId: string
      name?: string
      icon?: Record<string, unknown>
      projectPath?: string
    }
  // Message part editing
  | {
      type: 'delete_part'
      sessionId: string
      messageId: string
      partId: string
      projectPath?: string
    }
  | {
      type: 'update_part'
      sessionId: string
      messageId: string
      partId: string
      part: Record<string, unknown>
      projectPath?: string
    }
  // SDK skills endpoint
  | { type: 'oc_list_sdk_skills'; projectPath?: string }
  // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
  | { type: 'list_worktrees'; projectPath?: string }
  | {
      type: 'create_worktree'
      name?: string
      startCommand?: string
      projectPath?: string
    }
  | { type: 'reset_worktree'; worktreeDirectory: string; projectPath?: string }
  | { type: 'delete_worktree'; name: string; projectPath?: string }
  // Feature 16: Full Provider Management
  | { type: 'list_all_providers'; projectPath?: string }
  | { type: 'get_provider_auth'; projectPath?: string }
  | {
      type: 'provider_oauth_authorize'
      providerId: string
      method: number
      projectPath?: string
    }
  | {
      type: 'provider_oauth_callback'
      providerId: string
      method: number
      code?: string
      projectPath?: string
    }
  // Feature 17: Tool List
  | { type: 'list_tool_ids'; projectPath?: string }
  | {
      type: 'list_tools'
      provider: string
      model: string
      projectPath?: string
    }
  // Feature 18: File Status (Git)
  | { type: 'get_file_status'; projectPath?: string }
  // Feature 18b: Git diff (working tree / staged)
  | { type: 'git_diff'; projectPath: string; path?: string; staged?: boolean }
  // Git foundation
  | { type: 'git_status'; projectPath: string }
  | { type: 'git_log'; projectPath: string; limit?: number }
  | { type: 'git_branches'; projectPath: string }
  | { type: 'git_stage'; projectPath: string; path?: string }
  | { type: 'git_unstage'; projectPath: string; path?: string }
  | { type: 'git_revert_file'; projectPath: string; path: string }
  | { type: 'git_commit'; projectPath: string; message: string }
  | { type: 'git_push'; projectPath: string; force?: boolean }
  | { type: 'git_pull'; projectPath: string; rebase?: boolean }
  | { type: 'git_fetch'; projectPath: string }
  | { type: 'git_checkout'; projectPath: string; branch: string }
  | {
      type: 'git_create_branch'
      projectPath: string
      name: string
      startPoint?: string
    }
  | { type: 'git_stash'; projectPath: string }
  | { type: 'git_stash_pop'; projectPath: string }
  | { type: 'git_commit_diff'; projectPath: string; hash: string }
  // GitHub integration
  | { type: 'github_remote'; projectPath: string }
  | {
      type: 'github_issues'
      projectPath: string
      state?: 'open' | 'closed' | 'all'
    }
  | {
      type: 'github_prs'
      projectPath: string
      state?: 'open' | 'closed' | 'all'
    }
  | { type: 'github_pr_diff'; projectPath: string; prNumber: number }
  | { type: 'github_pr_comments'; projectPath: string; prNumber: number }
  // Feature 19: Formatter Status
  | { type: 'get_formatter_status'; projectPath?: string }
  // Feature 20: Session Init
  | {
      type: 'init_session'
      sessionId: string
      providerID: string
      modelID: string
      messageID: string
      projectPath?: string
    }
  // Feature 22: Instance Disposal (Clear project context)
  | { type: 'dispose_instance'; projectPath?: string }
  | { type: 'get_agents_status' }
  // Skills (filesystem-backed)
  | { type: 'oc_list_skills'; cwd?: string }
  | {
      type: 'oc_get_skill'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | {
      type: 'oc_save_skill'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'oc_delete_skill'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | { type: 'oc_list_plugin_files'; cwd?: string }
  | {
      type: 'oc_get_plugin_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | {
      type: 'oc_save_plugin_file'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'oc_delete_plugin_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  // OpenCode custom markdown files (filesystem-backed)
  | { type: 'oc_list_command_files'; cwd?: string }
  | {
      type: 'oc_get_command_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | {
      type: 'oc_save_command_file'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'oc_delete_command_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | { type: 'oc_list_agent_files'; cwd?: string }
  | {
      type: 'oc_get_agent_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | {
      type: 'oc_save_agent_file'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'oc_delete_agent_file'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  // OpenCode Question Tool
  | {
      type: 'oc_question_reply'
      questionId: string
      answers: string[][]
      projectPath?: string
    }
  | { type: 'oc_question_reject'; questionId: string; projectPath?: string }
  // Claude Code-specific messages
  | { type: 'cc_list_projects' }
  | { type: 'cc_list_sessions'; cwd?: string }
  | { type: 'cc_get_session'; sessionId: string; cwd?: string }
  | {
      type: 'cc_get_session_messages'
      sessionId: string
      cwd?: string
      limit?: number
    }
  | { type: 'cc_delete_session'; sessionId: string; cwd?: string }
  | {
      type: 'cc_fork_session'
      sessionId: string
      messageId?: string
      cwd?: string
    }
  | {
      type: 'cc_chat'
      sessionId?: string
      prompt: string
      cwd?: string
      model?: string
      permissionMode?: ClaudeCodePermissionMode
      allowedTools?: string[]
      disallowedTools?: string[]
      maxThinkingTokens?: number | null
      maxTurns?: number
      maxBudgetUsd?: number
      betas?: ClaudeCodeBeta[]
      variant?: string
      thinking?: ClaudeCodeThinkingOption
      effort?: ClaudeCodeEffort
      agent?: string
      systemPrompt?: ClaudeCodeSystemPrompt
      activeSubagent?: string
      fileAttachments?: FileAttachment[]
      resumeSessionAt?: string
      outputFormat?: ClaudeCodeOutputFormat
      sandbox?: ClaudeCodeSandboxSettings
      enableAgentTeams?: boolean
      persistSession?: boolean
      promptSuggestions?: boolean
      // B5: fallback model for auto-retry on primary model failure
      fallbackModel?: string
      // B6: additional directories agent can access beyond cwd
      additionalDirectories?: string[]
    }
  | { type: 'cc_abort'; sessionId: string }
  | { type: 'cc_stop_task'; sessionId: string; taskId: string }
  | { type: 'cc_reconnect_mcp_server'; sessionId: string; serverName: string }
  | {
      type: 'cc_toggle_mcp_server'
      sessionId: string
      serverName: string
      enabled: boolean
    }
  // B1: change permission mode mid-session
  | {
      type: 'cc_set_permission_mode'
      sessionId: string
      mode: ClaudeCodePermissionMode
    }
  // B2: change model mid-session
  | { type: 'cc_set_model'; sessionId: string; model?: string }
  // B7: dynamically set MCP servers mid-session
  | {
      type: 'cc_set_mcp_servers'
      sessionId: string
      servers: Record<string, unknown>
    }
  // B3: get full initialization result (richer than session-init)
  | { type: 'cc_initialization_result'; sessionId: string }
  | {
      type: 'cc_permission_response'
      sessionId: string
      toolUseId: string
      response: PermissionResponse
      // For AskUserQuestion: pass user-selected answers back to SDK via updatedInput
      updatedInput?: Record<string, unknown>
    }
  | { type: 'cc_list_skills'; cwd?: string }
  | {
      type: 'cc_get_skill'
      name: string
      source: 'project' | 'user' | 'plugin'
      cwd?: string
      path?: string
    }
  | {
      type: 'cc_save_skill'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'cc_delete_skill'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | { type: 'cc_list_hooks'; cwd?: string }
  | { type: 'cc_hooks_file_read'; source: 'project' | 'user'; cwd?: string }
  | {
      type: 'cc_hooks_file_write'
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | { type: 'cc_mcp_file_read'; cwd: string }
  | { type: 'cc_mcp_file_write'; cwd: string; content: string }
  | { type: 'cc_list_commands'; cwd?: string }
  | {
      type: 'cc_get_command'
      name: string
      source: 'project' | 'user' | 'plugin'
      cwd?: string
      path?: string
    }
  | {
      type: 'cc_save_command'
      name: string
      source: 'project' | 'user'
      content: string
      cwd?: string
    }
  | {
      type: 'cc_delete_command'
      name: string
      source: 'project' | 'user'
      cwd?: string
    }
  | { type: 'cc_get_config'; cwd?: string }
  | { type: 'cc_set_config'; config: Partial<ClaudeCodeConfig>; cwd?: string }
  | { type: 'cc_get_supported_models'; cwd?: string }
  | { type: 'cc_get_account_info'; cwd?: string }
  | { type: 'cc_get_mcp_server_status'; cwd?: string }
  | { type: 'cc_list_agents'; cwd?: string; projectPath?: string }
  | {
      type: 'cc_list_memories'
      scope?: 'user' | 'project' | 'local'
      cwd?: string
    }
  | {
      type: 'cc_delete_memory'
      scope: 'user' | 'project' | 'local'
      filename: string
      cwd?: string
    }
  | { type: 'cc_get_active_sessions' }
  | { type: 'cc_rename_session'; sessionId: string; name: string; cwd?: string }
  | { type: 'cc_background_session'; sessionId: string; cwd?: string }
  // Codex (OpenAI Codex app-server) messages
  | { type: 'cx_list_projects'; refresh?: boolean }
  | {
      type: 'cx_list_threads'
      cwd?: string
      cursor?: string | null
      limit?: number | null
      refresh?: boolean
      sourceKinds?: string[]
      sortKey?: string
      modelProviders?: string[]
      archived?: boolean
    }
  | { type: 'cx_warmup' }
  | {
      type: 'cx_start_thread'
      cwd?: string
      model?: string
      approvalPolicy?: string
      sandbox?: string
      personality?: 'none' | 'friendly' | 'pragmatic'
    }
  | {
      type: 'cx_resume_thread'
      threadId: string
      personality?: 'none' | 'friendly' | 'pragmatic'
    }
  | { type: 'cx_archive_thread'; threadId: string }
  | { type: 'cx_get_thread_messages'; threadId: string }
  | {
      type: 'cx_chat'
      threadId?: string
      prompt: string
      cwd?: string
      model?: string
      effort?: string
      summary?: string
      approvalPolicy?: string
      sandbox?: string
      sandboxPolicy?: any
      config?: Record<string, any>
      baseInstructions?: string
      developerInstructions?: string
      fileAttachments?: FileAttachment[]
      // SDK ModeKind: "plan" | "default". Legacy values accepted for backward compat and mapped to "default".
      collaborationMode?: 'plan' | 'default' | 'code' | 'pair_programming' | 'pairprogramming' | 'pairProgramming' | 'execute' | 'custom'
      // SDK Personality: "none" | "friendly" | "pragmatic" (default: pragmatic)
      personality?: 'none' | 'friendly' | 'pragmatic'
    }
  | { type: 'cx_abort'; threadId: string; turnId?: string }
  | {
      type: 'cx_permission_response'
      requestId: string
      response: PermissionResponse
      execpolicyAmendment?: any
      networkPolicyAmendment?: { host: string; action: 'allow' | 'deny' }
    }
  // Codex request_user_input response (SDK v0.87.0+)
  | {
      type: 'cx_user_input_response'
      requestId: string
      answers: Record<string, { answers: string[] }>
    }
  | { type: 'cx_thread_fork'; threadId: string }
  | { type: 'cx_thread_rollback'; threadId: string; numTurns: number }
  | { type: 'cx_model_list' }
  | { type: 'cx_skills_list'; cwd?: string; forceReload?: boolean }
  | {
      type: 'cx_get_skill'
      name: string
      scope: 'Repo' | 'User' | 'System' | 'Admin'
      cwd?: string
    }
  | {
      type: 'cx_save_skill'
      name: string
      scope: 'Repo' | 'User'
      content: string
      cwd?: string
    }
  | {
      type: 'cx_delete_skill'
      name: string
      scope: 'Repo' | 'User'
      cwd?: string
    }
  | { type: 'cx_list_prompts'; cwd?: string }
  | { type: 'cx_config_read' }
  | {
      type: 'cx_config_value_write'
      keyPath: string
      value: any
      mergeStrategy?: string
    }
  | {
      type: 'cx_mcp_status_list'
      cursor?: string | null
      limit?: number | null
    }
  | { type: 'cx_mcp_reload' }
  | {
      type: 'cx_review_start'
      threadId?: string
      cwd?: string
      delivery?: 'inline' | 'detached'
      target?: any
      model?: string
      approvalPolicy?: string
      sandbox?: string
      sandboxPolicy?: any
      config?: Record<string, any>
    }
  | { type: 'cx_account_read'; refreshToken?: boolean }
  | { type: 'cx_login_start'; loginType: 'chatgpt' | 'apiKey'; apiKey?: string }
  | { type: 'cx_login_cancel'; loginId: string }
  | { type: 'cx_logout' }
  | { type: 'cx_rate_limits_read' }
  | {
      type: 'cx_feedback_upload'
      classification: string
      reason?: string | null
      threadId?: string | null
      includeLogs?: boolean
      extraLogFiles?: string[] | null
    }
  | { type: 'cx_undo_files'; threadId: string; count?: number }
  | { type: 'cx_agents_read'; cwd: string }
  | { type: 'cx_agents_write'; cwd: string; content: string }
  // Codex new features (mid-2026 SDK update)
  | { type: 'cx_steer'; threadId: string; prompt: string; turnId?: string }
  | { type: 'cx_thread_rename'; threadId: string; name: string }
  | { type: 'cx_thread_unarchive'; threadId: string }
  | { type: 'cx_thread_compact'; threadId: string }
  | {
      type: 'cx_remote_skills_list'
      hazelnutScope?: 'example' | 'workspace-shared' | 'all-shared' | 'personal'
      productSurface?: 'chatgpt' | 'codex' | 'api' | 'atlas'
      enabled?: boolean
    }
  | { type: 'cx_remote_skill_install'; hazelnutId: string; isPreload?: boolean }
  | { type: 'cx_skill_config_write'; path: string; enabled: boolean }
  | {
      type: 'cx_apps_list'
      cursor?: string | null
      limit?: number | null
      threadId?: string
      forceRefetch?: boolean
    }
  | {
      type: 'cx_command_exec'
      command: string[]
      timeoutMs?: number
      cwd?: string
      sandboxPolicy?: any
    }
  | {
      type: 'cx_experimental_features'
      cursor?: string | null
      limit?: number | null
    }
  // Codex SDK update: new methods (#21-#25, #27)
  | {
      type: 'cx_config_batch_write'
      edits: Array<{ keyPath: string; value: any; mergeStrategy?: string }>
      filePath?: string
      expectedVersion?: string
    }
  | { type: 'cx_config_requirements_read' }
  | {
      type: 'cx_thread_loaded_list'
      cursor?: string | null
      limit?: number | null
    }
  | { type: 'cx_thread_read'; threadId: string; includeTurns?: boolean }
  | {
      type: 'cx_mcp_oauth_login'
      name: string
      scopes?: string[]
      timeoutSecs?: number
    }
  // Claude Code File Checkpointing (Undo/Revert)
  | {
      type: 'cc_rewind_checkpoint'
      sessionId: string
      checkpointUuid: string
      cwd: string
    }
  // Claude Code Custom Tools
  | { type: 'cc_list_custom_tools' }
  | { type: 'cc_get_custom_tool'; id: string }
  | { type: 'cc_save_custom_tool'; tool: ClaudeCodeCustomTool }
  | { type: 'cc_delete_custom_tool'; id: string }
  | {
      type: 'cc_test_custom_tool'
      tool: ClaudeCodeCustomTool
      testArgs: Record<string, unknown>
    }
  // Claude Code Plugins
  | { type: 'cc_list_plugins'; cwd?: string }
  | { type: 'cc_get_plugin'; name: string }
  | { type: 'cc_toggle_plugin'; name: string; enabled: boolean }
  | { type: 'cc_add_plugin_path'; path: string }
  | { type: 'cc_remove_plugin_path'; path: string }
  | { type: 'cc_get_plugin_config' }
  | { type: 'cc_reload_plugins'; cwd?: string }
  // Pi Coding Agent
  | {
      type: 'pi_chat'
      prompt: string
      projectPath?: string
      fileAttachments?: FileAttachment[]
      streamingBehavior?: 'steer' | 'followUp'
    }
  | { type: 'pi_steer'; message: string; projectPath?: string }
  | { type: 'pi_follow_up'; message: string; projectPath?: string }
  | { type: 'pi_abort'; projectPath?: string }
  | {
      type: 'pi_set_steering_mode'
      mode: 'all' | 'one-at-a-time'
      projectPath?: string
    }
  | {
      type: 'pi_set_follow_up_mode'
      mode: 'all' | 'one-at-a-time'
      projectPath?: string
    }
  | { type: 'pi_set_auto_retry'; enabled: boolean; projectPath?: string }
  | { type: 'pi_abort_retry'; projectPath?: string }
  | { type: 'pi_get_state'; projectPath?: string }
  | { type: 'pi_list_models'; projectPath?: string }
  | {
      type: 'pi_set_model'
      provider: string
      modelId: string
      projectPath?: string
    }
  | { type: 'pi_set_thinking_level'; level: string; projectPath?: string }
  | { type: 'pi_cycle_thinking_level'; projectPath?: string }
  | { type: 'pi_cycle_model'; projectPath?: string }
  | { type: 'pi_list_sessions'; projectPath?: string }
  | { type: 'pi_new_session'; projectPath?: string }
  | { type: 'pi_switch_session'; sessionPath: string; projectPath?: string }
  | { type: 'pi_delete_session'; sessionPath: string; projectPath?: string }
  | { type: 'pi_get_session_stats'; projectPath?: string }
  | { type: 'pi_get_messages'; projectPath?: string }
  | { type: 'pi_set_session_name'; name: string; projectPath?: string }
  | { type: 'pi_fork'; entryId: string; projectPath?: string }
  | { type: 'pi_get_fork_messages'; projectPath?: string }
  | {
      type: 'pi_navigate_tree'
      targetId: string
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
      projectPath?: string
    }
  | { type: 'pi_list_commands'; projectPath?: string }
  | { type: 'pi_compact'; customInstructions?: string; projectPath?: string }
  | { type: 'pi_set_auto_compaction'; enabled: boolean; projectPath?: string }
  | { type: 'pi_export_html'; outputPath?: string; projectPath?: string }
  | { type: 'pi_get_settings'; projectPath?: string }
  | {
      type: 'pi_set_settings'
      settings: Record<string, any>
      projectPath?: string
    }
  | { type: 'pi_dispose_instance'; projectPath?: string }
  | {
      type: 'pi_extension_ui_response'
      id: string
      value?: any
      confirmed?: boolean
      cancelled?: boolean
      projectPath?: string
    }
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
  slug?: string // URL-friendly slug (SDK v1.1.53+)
  title: string
  projectID: string
  directory: string
  parentID?: string // For forked sessions
  time: {
    created: number
    updated: number
    compacting?: number
    archived?: number
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
      status?: 'added' | 'deleted' | 'modified'
    }>
  }
  share?: {
    // Feature 8: Session sharing info
    url: string
  }
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
  permission?: PermissionRuleset // Session-level permissions (SDK v1.1.53+)
  project?: {
    id: string
    name?: string
    worktree: string
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
    contextTokens?: number // Tokens actually occupying the context window (input + cache)
    contextWindow: number // Model's max context
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
  }
  cost: number
  lsp: LspServerStatus[]
  modifiedFiles: Array<{
    file: string
    additions: number
    deletions: number
  }>
}

export type StatusPayload = {
  // Legacy field (keep for backwards compatibility with older mobile builds)
  opencodeRunning: boolean
  // Additive fields for multi-backend UX
  activeAgent?: AgentType
  backends?: Record<AgentType, AgentStatusInfo>
  // Bridge updater notifications
  updateAvailable?: boolean
  latestVersion?: string
  currentVersion?: string
}

export type ServerMessage =
  | {
      type: 'auth_session_ok'
      data: { appUserId: string; entitled: boolean; status?: string }
      requestId?: string
    }
  | { type: 'projects'; data: ProjectSummary[]; requestId?: string }
  | {
      type: 'sessions'
      data: SessionSummary[]
      projectPath?: string
      requestId?: string
    }
  | { type: 'providers'; data: unknown; requestId?: string }
  | { type: 'config'; data: unknown; requestId?: string }
  | { type: 'session'; data: SessionSummary; requestId?: string }
  | {
      type: 'session_messages'
      data: unknown
      sessionId: string
      requestId?: string
    }
  | { type: 'session_created'; data: SessionSummary; requestId?: string }
  | { type: 'diff'; data: unknown; sessionId: string; requestId?: string }
  | {
      type: 'browse_result'
      data: { path: string; items: unknown[] }
      requestId?: string
    }
  | { type: 'sdk_event'; data: unknown }
  | { type: 'sdk_event_batch'; data: unknown[] }
  | { type: 'ping'; data: { id: string; sentAt: number } }
  | { type: 'client_pong'; id: string; sentAt: number; receivedAt: number }
  | {
      type: 'connection_metrics'
      data: { rttMs: number; lastPongAt: number; connectionType?: string }
    }
  | { type: 'opencode_restarted'; data: boolean; requestId?: string }
  | { type: 'status'; data: StatusPayload }
  | { type: 'error'; message: string; code?: string; requestId?: string }
  | { type: 'lsp_status'; data: LspServerStatus[]; requestId?: string }
  | {
      type: 'session_context'
      data: SessionContextInfo
      sessionId: string
      requestId?: string
    }
  | {
      type: 'device_registered'
      data: DeviceInfo
      protocolVersion?: string
      requestId?: string
    }
  | { type: 'devices'; data: DeviceInfo[]; requestId?: string }
  | {
      type: 'device_disconnected'
      data: { deviceId: string; deviceName?: string }
      requestId?: string
    }
  | { type: 'device_connected'; data: DeviceInfo }
  | { type: 'pending_permissions'; data: unknown[]; requestId?: string }
  | { type: 'pending_questions'; data: unknown[]; requestId?: string }
  // Feature 1: Todo/Plan Management
  | { type: 'todos'; data: Todo[]; sessionId: string; requestId?: string }
  // Feature 2: Slash Commands
  | { type: 'commands'; data: Command[]; requestId?: string }
  | {
      type: 'command_executed'
      data: unknown
      sessionId: string
      requestId?: string
    }
  // Feature 3: Agent Switching
  | { type: 'agents'; data: Agent[]; requestId?: string }
  | { type: 'oc_question_replied'; data: boolean; requestId?: string }
  | { type: 'oc_question_rejected'; data: boolean; requestId?: string }
  // Skills (filesystem-backed)
  | {
      type: 'oc_skills'
      data: Array<{
        name: string
        description?: string
        path: string
        source: 'project' | 'user' | 'system' | 'admin' | 'plugin'
        editable: boolean
      }>
      requestId?: string
    }
  | {
      type: 'oc_skill'
      data: {
        name: string
        path: string
        source: 'project' | 'user'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'oc_skill_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | { type: 'oc_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | {
      type: 'oc_plugin_files'
      data: Array<{ name: string; path: string; source: 'project' | 'user' }>
      requestId?: string
    }
  | {
      type: 'oc_plugin_file'
      data: {
        name: string
        path: string
        source: 'project' | 'user'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'oc_plugin_file_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | {
      type: 'oc_plugin_file_deleted'
      data: { ok: boolean }
      requestId?: string
    }
  | {
      type: 'oc_command_files'
      data: Array<{
        name: string
        path: string
        source: 'project' | 'user'
        description?: string
      }>
      requestId?: string
    }
  | {
      type: 'oc_command_file'
      data: {
        name: string
        path: string
        source: 'project' | 'user'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'oc_command_file_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | {
      type: 'oc_command_file_deleted'
      data: { ok: boolean }
      requestId?: string
    }
  | {
      type: 'oc_agent_files'
      data: Array<{
        name: string
        path: string
        source: 'project' | 'user'
        description?: string
      }>
      requestId?: string
    }
  | {
      type: 'oc_agent_file'
      data: {
        name: string
        path: string
        source: 'project' | 'user'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'oc_agent_file_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | { type: 'oc_agent_file_deleted'; data: { ok: boolean }; requestId?: string }
  // Feature 4: Session Delete
  | {
      type: 'session_deleted'
      data: boolean
      sessionId: string
      requestId?: string
    }
  // Feature 5: Session Update (Rename)
  | {
      type: 'session_updated'
      data: SessionSummary
      sessionId: string
      requestId?: string
    }
  // Feature 6: Session Fork
  | { type: 'session_forked'; data: SessionSummary; requestId?: string }
  | {
      type: 'session_children'
      data: SessionSummary[]
      sessionId: string
      requestId?: string
    }
  // Feature 7: Message Revert (Undo)
  | {
      type: 'message_reverted'
      data: SessionSummary
      sessionId: string
      requestId?: string
    }
  | {
      type: 'session_unreverted'
      data: SessionSummary
      sessionId: string
      requestId?: string
    }
  // Feature 8: Session Share
  | {
      type: 'session_shared'
      data: SessionSummary
      sessionId: string
      requestId?: string
    }
  | {
      type: 'session_unshared'
      data: SessionSummary
      sessionId: string
      requestId?: string
    }
  // Feature 9: Session Summarize (Compact)
  | {
      type: 'session_summarized'
      data: boolean
      sessionId: string
      requestId?: string
    }
  // Feature 10: Git/VCS Information
  | { type: 'vcs'; data: VcsInfo; requestId?: string }
  // Feature 11: File Content Read
  | {
      type: 'file_content'
      data: FileContent
      path: string
      requestId?: string
    }
  // Feature 21: Binary File Content
  | {
      type: 'file_binary'
      data: FileBinaryContent
      path: string
      requestId?: string
    }
  | {
      type: 'file_too_large'
      data: { path: string; size: number; maxSize: number }
      requestId?: string
    }
  // Feature 12: File Search
  | { type: 'files_found'; data: string[]; requestId?: string }
  | { type: 'text_found'; data: TextSearchResult[]; requestId?: string }
  | { type: 'symbols_found'; data: SymbolResult[]; requestId?: string }
  | { type: 'files_and_dirs_found'; data: string[]; requestId?: string }
  // Feature 13: Session Status
  | {
      type: 'session_status'
      data: Record<string, SessionStatusInfo>
      requestId?: string
    }
  // Feature 14: PTY Terminal Sessions
  | { type: 'pty_list'; data: PtySession[]; requestId?: string }
  | { type: 'pty_created'; data: PtySession; requestId?: string }
  | { type: 'pty'; data: PtySession; requestId?: string }
  | { type: 'pty_updated'; data: PtySession; requestId?: string }
  | { type: 'pty_deleted'; data: boolean; ptyId: string; requestId?: string }
  | { type: 'pty_connected'; data: { ptyId: string }; requestId?: string }
  | { type: 'pty_disconnected'; data: { ptyId: string }; requestId?: string }
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
  | {
      type: 'mcp_status'
      data: Record<string, McpServerStatus>
      requestId?: string
    }
  | {
      type: 'mcp_added'
      data: Record<string, McpServerStatus>
      requestId?: string
    }
  | { type: 'mcp_connected'; data: boolean; name: string; requestId?: string }
  | {
      type: 'mcp_disconnected'
      data: boolean
      name: string
      requestId?: string
    }
  | {
      type: 'mcp_resources'
      data: Record<string, McpResource>
      requestId?: string
    }
  // MCP OAuth
  | {
      type: 'mcp_auth_started'
      data: { authorizationUrl: string } | null
      name: string
      requestId?: string
    }
  | {
      type: 'mcp_auth_completed'
      data: boolean
      name: string
      requestId?: string
    }
  | {
      type: 'mcp_auth_authenticated'
      data: Record<string, unknown> | null
      name: string
      requestId?: string
    }
  | {
      type: 'mcp_auth_removed'
      data: boolean
      name: string
      requestId?: string
    }
  // Provider credentials
  | {
      type: 'auth_set_result'
      data: boolean
      providerId: string
      requestId?: string
    }
  | {
      type: 'auth_removed_result'
      data: boolean
      providerId: string
      requestId?: string
    }
  // Global config
  | { type: 'global_config'; data: Record<string, unknown>; requestId?: string }
  // Project management
  | {
      type: 'current_project'
      data: Record<string, unknown> | null
      requestId?: string
    }
  | {
      type: 'project_updated'
      data: Record<string, unknown>
      requestId?: string
    }
  // Message part editing
  | { type: 'part_deleted'; data: boolean; requestId?: string }
  | { type: 'part_updated'; data: Record<string, unknown>; requestId?: string }
  // SDK skills
  | {
      type: 'oc_sdk_skills'
      data: Array<{
        name: string
        description: string
        location: string
        content: string
      }>
      requestId?: string
    }
  // Feature 23: Git Worktrees
  | { type: 'worktrees'; data: Worktree[]; requestId?: string }
  | { type: 'worktree_created'; data: Worktree; requestId?: string }
  | {
      type: 'worktree_reset'
      data: boolean
      worktreeDirectory: string
      requestId?: string
    }
  | {
      type: 'worktree_deleted'
      data: boolean
      name: string
      requestId?: string
    }
  // Feature 16: Full Provider Management
  | { type: 'all_providers'; data: ProviderInfo; requestId?: string }
  | {
      type: 'provider_auth'
      data: Record<string, ProviderAuthMethod[]>
      requestId?: string
    }
  | {
      type: 'provider_oauth_authorized'
      data: ProviderAuthAuthorization | null
      providerId: string
      requestId?: string
    }
  | {
      type: 'provider_oauth_callback'
      data: boolean
      providerId: string
      requestId?: string
    }
  // Feature 17: Tool List
  | { type: 'tool_ids'; data: string[]; requestId?: string }
  | { type: 'tools'; data: ToolInfo[]; requestId?: string }
  // Feature 18: File Status (Git)
  | { type: 'file_status'; data: FileStatusInfo[]; requestId?: string }
  | {
      type: 'git_diff'
      data: { path?: string; diff: string; staged?: boolean }
      requestId?: string
    }
  // Git foundation
  | { type: 'git_status_result'; data: GitStatusResult; requestId?: string }
  | { type: 'git_log_result'; data: GitLogEntry[]; requestId?: string }
  | { type: 'git_branches_result'; data: GitBranch[]; requestId?: string }
  | { type: 'git_staged'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_unstaged'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_reverted'; data: { ok: boolean }; requestId?: string }
  | {
      type: 'git_committed'
      data: { hash: string; subject: string }
      requestId?: string
    }
  | { type: 'git_pushed'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_pulled'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_fetched'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_checked_out'; data: { branch: string }; requestId?: string }
  | { type: 'git_branch_created'; data: { name: string }; requestId?: string }
  | { type: 'git_stashed'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_stash_popped'; data: { ok: boolean }; requestId?: string }
  | { type: 'git_commit_diff_result'; data: string; requestId?: string }
  // GitHub integration
  | {
      type: 'github_remote_result'
      data: GitHubRemote | null
      requestId?: string
    }
  | { type: 'github_issues_result'; data: GitHubIssue[]; requestId?: string }
  | { type: 'github_prs_result'; data: GitHubPR[]; requestId?: string }
  | { type: 'github_pr_diff_result'; data: string; requestId?: string }
  | {
      type: 'github_pr_comments_result'
      data: GitHubComment[]
      requestId?: string
    }
  // Feature 19: Formatter Status
  | { type: 'formatter_status'; data: FormatterInfo[]; requestId?: string }
  // Feature 20: Session Init
  | {
      type: 'session_initialized'
      data: boolean
      sessionId: string
      requestId?: string
    }
  | { type: 'instance_disposed'; data: boolean; requestId?: string }
  | {
      type: 'agents_status'
      data: Record<AgentType, AgentStatusInfo>
      requestId?: string
    }
  | { type: 'cc_projects'; data: ProjectSummary[]; requestId?: string }
  | { type: 'cc_sessions'; data: ClaudeCodeSession[]; requestId?: string }
  | { type: 'cc_session'; data: ClaudeCodeSession; requestId?: string }
  | {
      type: 'cc_session_deleted'
      data: boolean
      sessionId: string
      requestId?: string
    }
  | {
      type: 'cc_session_forked'
      data: ClaudeCodeSession | null
      requestId?: string
    }
  | {
      type: 'cc_session_renamed'
      data: ClaudeCodeSession | null
      requestId?: string
    }
  | {
      type: 'cc_session_backgrounded'
      data: boolean
      sessionId: string
      requestId?: string
    }
  | {
      type: 'cc_session_messages'
      data: ClaudeCodeTranscriptMessage[]
      sessionId: string
      requestId?: string
    }
  | { type: 'cc_skills'; data: ClaudeCodeSkill[]; requestId?: string }
  | {
      type: 'cc_skill'
      data: {
        name: string
        path: string
        source: 'project' | 'user' | 'plugin'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'cc_skill_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | { type: 'cc_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'cc_hooks'; data: ClaudeCodeHook[]; requestId?: string }
  | {
      type: 'cc_hooks_file'
      data: {
        ok: boolean
        source: 'project' | 'user'
        path: string
        content: string
      }
      requestId?: string
    }
  | {
      type: 'cc_hooks_file_written'
      data: { ok: boolean; source: 'project' | 'user'; path: string }
      requestId?: string
    }
  | {
      type: 'cc_mcp_file'
      data: { ok: boolean; path: string; content: string }
      requestId?: string
    }
  | {
      type: 'cc_mcp_file_written'
      data: { ok: boolean; path: string }
      requestId?: string
    }
  | { type: 'cc_commands'; data: ClaudeCodeCommand[]; requestId?: string }
  | { type: 'cc_agents'; data: ClaudeCodeFilesystemAgent[]; requestId?: string }
  | { type: 'cc_memories'; data: ClaudeCodeMemoryEntry[]; requestId?: string }
  | {
      type: 'cc_memory_deleted'
      data: { ok: boolean; filename: string; scope: string }
      requestId?: string
    }
  | {
      type: 'cc_active_sessions'
      data: Array<{ id: string; cwd: string; startedAt?: number }>
      requestId?: string
    }
  | {
      type: 'cc_command_file'
      data: {
        ok: boolean
        name: string
        source: 'project' | 'user' | 'plugin'
        path: string
        content: string
      }
      requestId?: string
    }
  | {
      type: 'cc_command_saved'
      data: {
        ok: boolean
        name: string
        source: 'project' | 'user'
        path?: string
      }
      requestId?: string
    }
  | {
      type: 'cc_command_deleted'
      data: { ok: boolean; name: string; source: 'project' | 'user' }
      requestId?: string
    }
  | { type: 'cc_config'; data: ClaudeCodeConfig; requestId?: string }
  | { type: 'cc_config_updated'; data: ClaudeCodeConfig; requestId?: string }
  | {
      type: 'cc_supported_models'
      data: ClaudeCodeSupportedModel[]
      requestId?: string
    }
  | { type: 'cc_account_info'; data: ClaudeCodeAccountInfo; requestId?: string }
  | {
      type: 'cc_mcp_server_status'
      data: ClaudeCodeMcpServerStatus[]
      requestId?: string
    }
  | {
      type: 'cc_checkpoint_rewound'
      data: {
        success: boolean
        sessionId: string
        checkpointUuid: string
        filesChanged?: string[]
        insertions?: number
        deletions?: number
      }
      requestId?: string
    }
  | {
      type: 'cc_task_stopped'
      data: { ok: boolean; taskId: string }
      requestId?: string
    }
  | {
      type: 'cc_mcp_server_reconnected'
      data: { ok: boolean; serverName: string }
      requestId?: string
    }
  | {
      type: 'cc_mcp_server_toggled'
      data: { ok: boolean; serverName: string; enabled: boolean }
      requestId?: string
    }
  | {
      type: 'cc_permission_mode_set'
      data: { ok: boolean; mode: ClaudeCodePermissionMode }
      requestId?: string
    }
  | {
      type: 'cc_model_set'
      data: { ok: boolean; model?: string }
      requestId?: string
    }
  | {
      type: 'cc_mcp_servers_set'
      data: {
        added: string[]
        removed: string[]
        errors: Record<string, string>
      } | null
      requestId?: string
    }
  | {
      type: 'cc_initialization_result'
      data: Record<string, unknown> | null
      requestId?: string
    }
  | {
      type: 'cc_fs_changed'
      data: {
        kind: 'skills' | 'plugins' | 'hooks' | 'commands' | 'mcp'
        dir: string
        cwd?: string
        file?: string
      }
      requestId?: string
    }
  | { type: 'cc_stream'; data: ClaudeCodeStreamMessage; sessionId: string }
  // Codex (OpenAI Codex app-server)
  | {
      type: 'cx_global'
      data: { method: string; params?: any }
      requestId?: string
    }
  | { type: 'cx_projects'; data: ProjectSummary[]; requestId?: string }
  | { type: 'cx_warmup_started'; requestId?: string }
  | {
      type: 'cx_threads'
      data: CodexThread[]
      nextCursor?: string | null
      requestId?: string
    }
  | {
      type: 'cx_models'
      data: any
      nextCursor?: string | null
      requestId?: string
    }
  | { type: 'cx_thread'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_created'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_forked'; data: CodexThread; requestId?: string }
  | { type: 'cx_thread_rolled_back'; data: CodexThread; requestId?: string }
  | {
      type: 'cx_thread_archived'
      data: boolean
      threadId: string
      requestId?: string
    }
  | {
      type: 'cx_thread_messages'
      data: CodexTranscriptMessage[]
      threadId: string
      requestId?: string
    }
  | { type: 'cx_skills'; data: any; requestId?: string }
  | {
      type: 'cx_skill'
      data: {
        name: string
        path: string
        scope: 'Repo' | 'User' | 'System' | 'Admin'
        content: string
      }
      requestId?: string
    }
  | {
      type: 'cx_skill_saved'
      data: { ok: boolean; path?: string }
      requestId?: string
    }
  | { type: 'cx_skill_deleted'; data: { ok: boolean }; requestId?: string }
  | { type: 'cx_prompts'; data: CodexPrompt[]; requestId?: string }
  | { type: 'cx_config'; data: any; requestId?: string }
  | { type: 'cx_config_written'; data: any; requestId?: string }
  | {
      type: 'cx_mcp_status'
      data: any
      nextCursor?: string | null
      requestId?: string
    }
  | { type: 'cx_mcp_reloaded'; data: any; requestId?: string }
  | {
      type: 'cx_review_started'
      data: { threadId: string; reviewThreadId: string; turnId: string }
      requestId?: string
    }
  | { type: 'cx_account'; data: any; requestId?: string }
  | { type: 'cx_login_started'; data: any; requestId?: string }
  | { type: 'cx_login_canceled'; data: any; requestId?: string }
  | { type: 'cx_logged_out'; data: any; requestId?: string }
  | { type: 'cx_rate_limits'; data: any; requestId?: string }
  | { type: 'cx_feedback_uploaded'; data: any; requestId?: string }
  | {
      type: 'cx_undo_result'
      data: { ok: boolean; revertedPaths: string[]; error?: string }
      requestId?: string
    }
  | {
      type: 'cx_agents'
      data: { exists: boolean; path: string; content: string }
      requestId?: string
    }
  | {
      type: 'cx_agents_written'
      data: { ok: boolean; path: string }
      requestId?: string
    }
  // Codex new features (mid-2026 SDK update)
  | { type: 'cx_steered'; data: any; requestId?: string }
  | { type: 'cx_thread_renamed'; data: any; requestId?: string }
  | { type: 'cx_thread_unarchived'; data: any; requestId?: string }
  | { type: 'cx_thread_compacted'; data: any; requestId?: string }
  | { type: 'cx_remote_skills'; data: CodexRemoteSkill[]; requestId?: string }
  | { type: 'cx_remote_skill_installed'; data: any; requestId?: string }
  | { type: 'cx_skill_config_written'; data: any; requestId?: string }
  | {
      type: 'cx_apps'
      data: CodexAppInfo[]
      nextCursor?: string | null
      requestId?: string
    }
  | {
      type: 'cx_command_result'
      data: { exitCode?: number; stdout?: string; stderr?: string }
      requestId?: string
    }
  | { type: 'cx_experimental_features_list'; data: any[]; requestId?: string }
  // Codex SDK update: new response types (#21-#25, #19)
  | { type: 'cx_config_batch_written'; data: any; requestId?: string }
  | { type: 'cx_config_requirements'; data: any; requestId?: string }
  | {
      type: 'cx_thread_loaded_list'
      data: string[]
      nextCursor?: string | null
      requestId?: string
    }
  | { type: 'cx_thread_detail'; data: any; requestId?: string }
  | {
      type: 'cx_mcp_oauth_login_started'
      data: { authorizationUrl: string }
      name: string
      requestId?: string
    }
  | { type: 'cx_apps_updated'; data: any[]; requestId?: string }
  | { type: 'cx_stream'; data: CodexStreamMessage; threadId: string }
  // Claude Code Custom Tools
  | {
      type: 'cc_custom_tools'
      data: ClaudeCodeCustomTool[]
      requestId?: string
    }
  | {
      type: 'cc_custom_tool'
      data: ClaudeCodeCustomTool | null
      requestId?: string
    }
  | {
      type: 'cc_custom_tool_saved'
      data: ClaudeCodeCustomTool
      requestId?: string
    }
  | {
      type: 'cc_custom_tool_deleted'
      data: boolean
      id: string
      requestId?: string
    }
  | {
      type: 'cc_custom_tool_test_result'
      data: { success: boolean; result?: string; error?: string }
      requestId?: string
    }
  // Claude Code Plugins
  | { type: 'cc_plugins'; data: ClaudeCodePlugin[]; requestId?: string }
  | { type: 'cc_plugin'; data: ClaudeCodePlugin | null; requestId?: string }
  | {
      type: 'cc_plugin_toggled'
      data: boolean
      name: string
      enabled: boolean
      requestId?: string
    }
  | {
      type: 'cc_plugin_path_added'
      data: boolean
      path: string
      requestId?: string
    }
  | {
      type: 'cc_plugin_path_removed'
      data: boolean
      path: string
      requestId?: string
    }
  | {
      type: 'cc_plugin_config'
      data: ClaudeCodePluginConfig
      requestId?: string
    }
  | {
      type: 'cc_plugins_reloaded'
      data: ClaudeCodePlugin[]
      requestId?: string
    }
  // Pi Coding Agent
  | { type: 'pi_chat_started'; data: boolean; requestId?: string }
  | { type: 'pi_steered'; data: boolean; requestId?: string }
  | { type: 'pi_followed_up'; data: boolean; requestId?: string }
  | { type: 'pi_aborted'; data: boolean; requestId?: string }
  | {
      type: 'pi_steering_mode_set'
      data: { mode: 'all' | 'one-at-a-time' }
      requestId?: string
    }
  | {
      type: 'pi_follow_up_mode_set'
      data: { mode: 'all' | 'one-at-a-time' }
      requestId?: string
    }
  | { type: 'pi_auto_retry_set'; data: boolean; requestId?: string }
  | { type: 'pi_retry_aborted'; data: boolean; requestId?: string }
  | { type: 'pi_state'; data: PiStatePayload; requestId?: string }
  | { type: 'pi_models'; data: PiModelPayload[]; requestId?: string }
  | { type: 'pi_model_set'; data: PiModelPayload | null; requestId?: string }
  | { type: 'pi_thinking_level'; data: { level: string }; requestId?: string }
  | { type: 'pi_sessions'; data: PiSessionInfo[]; requestId?: string }
  | { type: 'pi_session_created'; data: boolean; requestId?: string }
  | { type: 'pi_session_switched'; data: boolean; requestId?: string }
  | { type: 'pi_session_deleted'; data: boolean; requestId?: string }
  | { type: 'pi_session_stats'; data: any; requestId?: string }
  | { type: 'pi_messages'; data: any[]; requestId?: string }
  | { type: 'pi_session_name_set'; data: boolean; requestId?: string }
  | {
      type: 'pi_fork_result'
      data: { text: string; cancelled: boolean }
      requestId?: string
    }
  | {
      type: 'pi_fork_messages'
      data: PiForkMessagePayload[]
      requestId?: string
    }
  | {
      type: 'pi_tree_navigated'
      data: { editorText?: string; cancelled: boolean; aborted?: boolean }
      requestId?: string
    }
  | { type: 'pi_commands'; data: PiCommandPayload[]; requestId?: string }
  | { type: 'pi_compacted'; data: any; requestId?: string }
  | { type: 'pi_auto_compaction_set'; data: boolean; requestId?: string }
  | { type: 'pi_export_result'; data: { path: string }; requestId?: string }
  | { type: 'pi_settings'; data: Record<string, any>; requestId?: string }
  | { type: 'pi_settings_updated'; data: boolean; requestId?: string }
  | { type: 'pi_instance_disposed'; data: boolean; requestId?: string }
  | { type: 'pi_extension_ui_responded'; data: boolean; requestId?: string }
  | { type: 'pi_stream'; data: PiStreamMessage; sessionId: string }
  // Subscription Usage Tracking
  | { type: 'subscription_usage'; data: SubscriptionUsage; requestId?: string }
  | { type: 'provider_usage'; data: ProviderUsage; requestId?: string }

// Feature 11: File Content
export type FileContent = {
  type: 'text' | 'binary'
  content: string
  mime?: string
  mimeType?: string
  encoding?: 'base64'
  diff?: string
  patch?: unknown
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
export type SessionStatusInfo = { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }

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
  status:
    | 'connected'
    | 'disabled'
    | 'failed'
    | 'needs_auth'
    | 'needs_client_registration'
    // Legacy values kept for backward compatibility
    | 'disconnected'
    | 'connecting'
    | 'error'
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
  client: string // Which MCP server provides this resource
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

export type WorktreeResetInput = {
  directory: string
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
  family?: string
  contextWindow?: number
  outputLimit?: number
  reasoning?: boolean
  attachment?: boolean
  toolCall?: boolean
  modalities?: {
    input: string[]
    output: string[]
  }
  status?: 'alpha' | 'beta' | 'deprecated' | 'active'
  experimental?: boolean
  pricing?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
  variants?: Record<string, Record<string, unknown>>
}

export type ProviderAuthMethod = {
  type: 'api' | 'oauth'
  label?: string
  name?: string
  description?: string
  url?: string
}

export type ProviderAuthAuthorization = {
  url: string
  method: 'auto' | 'code'
  instructions: string
}

// Feature 17: Tool Info
export type ToolInfo = {
  id: string
  description?: string
  parameters?: Record<string, unknown>
}

// Feature 18: File Status (Git)
export type FileStatusInfo = {
  path: string
  added: number
  removed: number
  status: 'modified' | 'added' | 'deleted'
}

export type GitChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied'

export type GitFileChange = {
  path: string
  status: GitChangeStatus
  oldPath?: string
  additions?: number
  deletions?: number
}

export type GitStatusResult = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: string[]
}

export type GitLogEntry = {
  hash: string
  shortHash: string
  author: string
  email: string
  timestamp: number
  subject: string
}

export type GitBranch = {
  name: string
  upstream: string | null
  tracking: string | null
  isCurrent: boolean
  isRemote: boolean
}

export type GitHubRemote = {
  owner: string
  repo: string
  host: string
}

export type GitHubIssue = {
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  labels: string[]
  body?: string
}

export type GitHubPR = {
  number: number
  title: string
  state: string
  author: string
  headBranch: string
  baseBranch: string
  createdAt: string
  isDraft: boolean
  isMerged: boolean
}

export type GitHubComment = {
  author: string
  body: string
  path?: string
  line?: number
  createdAt: string
}

// Feature 19: Formatter Info (matches SDK FormatterStatus shape)
export type FormatterInfo = {
  name: string
  extensions: string[]
  enabled: boolean
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
  agent?: string
  context?: 'fork'
}

// Claude Code Hook Event Types
export type ClaudeCodeHookEvent = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Notification' | 'SessionStart' | 'SessionEnd' | 'Stop' | 'PermissionRequest' | 'UserPromptSubmit' | 'SubagentStart' | 'SubagentStop' | 'TeammateIdle' | 'TaskCompleted' | 'PreCompact' | 'Setup'

// Claude Code Hook Configuration
export type ClaudeCodeHook = {
  id: string
  event: ClaudeCodeHookEvent
  matcher?: string // Tool name pattern (e.g., 'Bash', 'Write|Edit')
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
  isBackground?: boolean
  hasSubagentActivity?: boolean
  subagentName?: string
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
export type ClaudeCodePermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'

export type ClaudeCodeBeta = 'context-1m-2025-08-07'

export type ClaudeCodeSystemPrompt = string | { type: 'preset'; preset: 'claude_code'; append?: string } | null

export type ClaudeCodeOutputFormat = {
  type: 'json_schema'
  schema: Record<string, unknown>
}

export type ClaudeCodeSandboxNetworkConfig = {
  allowedDomains?: string[]
  allowManagedDomainsOnly?: boolean
  allowUnixSockets?: string[]
  allowAllUnixSockets?: boolean
  allowLocalBinding?: boolean
  httpProxyPort?: number
  socksProxyPort?: number
}

export type ClaudeCodeSandboxSettings = {
  enabled?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
  network?: ClaudeCodeSandboxNetworkConfig
  filesystem?: {
    allowWrite?: string[]
    denyWrite?: string[]
    denyRead?: string[]
  }
  ignoreViolations?: Record<string, string[]>
  enableWeakerNestedSandbox?: boolean
  excludedCommands?: string[]
  ripgrep?: { command: string; args?: string[] }
}

// Claude Code Filesystem Agent (discovered from .claude/agents/*.md)
export type ClaudeCodeFilesystemAgent = {
  name: string // Derived from filename (without .md)
  description?: string // From frontmatter or first paragraph
  prompt?: string // Full markdown content (the agent's instructions)
  tools?: string[] // From frontmatter 'tools' field
  model?: string // From frontmatter 'model' field
  memory?: 'user' | 'project' | 'local' // From frontmatter 'memory' field
  source: 'project' | 'user' // Project-level (.claude/agents/) or user-level (~/.claude/agents/)
  path: string // Absolute path to the .md file
}

// Claude Code Memory Entry (from ~/.claude/memory/ or .claude/memory/)
export type ClaudeCodeMemoryEntry = {
  scope: 'user' | 'project' | 'local'
  filename: string // e.g. "2025-02-07T12-00-00.md"
  content: string // Full markdown content
  createdAt?: string // ISO date from filename or stat
  path: string // Absolute path to the file
}

// Claude Code Subagent Definition (matches SDK AgentDefinition)
export type ClaudeCodeSubagent = {
  name: string // Unique identifier for the subagent
  description: string // When Claude should use this subagent
  prompt: string // System prompt for the subagent
  tools?: string[] // Allowed tools (inherits if omitted)
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit' // Model override
  permissionMode?: ClaudeCodePermissionMode
  disallowedTools?: string[]
  skills?: string[] // Skills to preload
  maxTurns?: number // Max agentic turns
  mcpServers?: Array<string | Record<string, unknown>> // Per-subagent MCP servers (B14)
}

// Claude Code Custom Tool Parameter
export type ClaudeCodeCustomToolParameter = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  required?: boolean
  default?: unknown
  enum?: string[] // For string types with fixed options
}

// Claude Code Custom Tool HTTP Handler Config
export type ClaudeCodeHttpHandlerConfig = {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  bodyTemplate?: string // JSON template with {{param}} placeholders
}

// Claude Code Custom Tool Script Handler Config
export type ClaudeCodeScriptHandlerConfig = {
  command: string
  args?: string[]
  cwd?: string
  timeout?: number
  shell?: boolean
}

// Claude Code Custom Tool Builtin Handler Config (reserved)
export type ClaudeCodeBuiltinHandlerConfig = {
  action: string
  config?: Record<string, unknown>
}

// Claude Code Custom Tool Definition
export type ClaudeCodeCustomTool = {
  id: string
  name: string
  description: string
  parameters: ClaudeCodeCustomToolParameter[]
  handler: 'http' | 'script' | 'builtin'
  handlerConfig: ClaudeCodeHttpHandlerConfig | ClaudeCodeScriptHandlerConfig | ClaudeCodeBuiltinHandlerConfig
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
  path: string // Absolute path to plugin directory
  status: ClaudeCodePluginStatus
  manifest?: ClaudeCodePluginManifest
  // Discovered components
  commands?: string[] // Slash commands provided by plugin
  agents?: string[] // Agent definitions
  skills?: string[] // Skills provided
  hasHooks?: boolean // Has hooks.json
  hasMcpServers?: boolean // Has MCP server configs
  // Runtime info
  loadedAt?: number // When plugin was last loaded
  error?: string // Error message if status is 'error'
}

// Plugin configuration (what we store in ~/.broski/plugins-config.json)
export type ClaudeCodePluginConfig = {
  enabled: string[] // Plugin names that are enabled
  disabled: string[] // Plugin names that are explicitly disabled
  customPaths: string[] // Additional plugin paths to scan
}

// Claude Code Thinking Option (SDK 0.2.42+)
export type ClaudeCodeThinkingOption = { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' }

// Claude Code Effort Level (SDK 0.2.42+)
export type ClaudeCodeEffort = 'low' | 'medium' | 'high' | 'max'

// Claude Code Configuration
export type ClaudeCodeConfig = {
  permissionMode: ClaudeCodePermissionMode
  allowedTools: string[]
  disallowedTools: string[]
  model?: string
  systemPrompt?: ClaudeCodeSystemPrompt
  maxTurns?: number
  maxBudgetUsd?: number
  betas?: ClaudeCodeBeta[]
  sandbox?: ClaudeCodeSandboxSettings
  outputFormat?: ClaudeCodeOutputFormat
  enableAgentTeams?: boolean
  thinking?: ClaudeCodeThinkingOption
  effort?: ClaudeCodeEffort
  promptSuggestions?: boolean
  // Project/user settings (persisted in Claude Code settings.json)
  language?: string
  releaseChannel?: 'stable' | 'latest'
  respectGitignore?: boolean
  subagents?: ClaudeCodeSubagent[] // Custom subagent definitions
  activeSubagent?: string // Currently selected subagent name
}

export type ClaudeCodeSupportedModel = {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[]
  supportsAdaptiveThinking?: boolean
}

export type ClaudeCodeAccountInfo = {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
}

export type ClaudeCodeMcpToolAnnotations = {
  readOnly?: boolean
  destructive?: boolean
  openWorld?: boolean
}

export type ClaudeCodeMcpServerStatus = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  serverInfo?: {
    name: string
    version: string
  }
  error?: string
  config?: Record<string, unknown>
  scope?: string
  tools?: Array<{
    name: string
    description?: string
    annotations?: ClaudeCodeMcpToolAnnotations
  }>
}

export type ClaudeCodeModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export type ClaudeCodePermissionDenial = {
  toolName: string
  toolUseId: string
  // SDK always sends tool_input (required), but we keep optional for defensive runtime safety.
  toolInput?: Record<string, unknown>
}

// Claude Code Message (for streaming)
export type ClaudeCodeStreamMessage =
  | {
      type: 'session-created'
      sessionId: string
      agent: 'claude-code'
      model?: string
      parentToolUseId?: string
    }
  | {
      type: 'session-init'
      sessionId: string
      model: string
      permissionMode: ClaudeCodePermissionMode
      tools: string[]
      slashCommands: string[]
      skills: string[]
      agents: string[]
      mcpServers: Array<{ name: string; status: string }>
      plugins: Array<{ name: string; path: string }>
      apiKeySource?: string
      claudeCodeVersion?: string
      betas?: string[]
      outputStyle?: string
      supportedModels?: ClaudeCodeSupportedModel[]
      accountInfo?: ClaudeCodeAccountInfo
      parentToolUseId?: string
    }
  | {
      type: 'compact-boundary'
      trigger: 'manual' | 'auto'
      preTokens: number
      parentToolUseId?: string
    }
  | {
      type: 'permission-request'
      sessionId: string
      toolUseId: string
      tool: string
      input: Record<string, unknown>
      decisionReason?: string
      blockedPath?: string
      hasSuggestions?: boolean
      description?: string
      agentId?: string
      parentToolUseId?: string
    }
  | {
      type: 'checkpoint-created'
      sessionId: string
      checkpointUuid: string
      timestamp: number
      parentToolUseId?: string
    }
  | {
      type: 'assistant-message'
      content: string
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'assistant-message-delta'
      content: string
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'thinking-delta'
      content: string
      partId?: string
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'tool-call'
      tool: string
      input: any
      toolUseId?: string
      status: 'running' | 'completed' | 'failed'
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'tool-result'
      toolUseId?: string
      result: any
      toolUseResult?: any
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'subagent-invocation'
      subagentName: string
      toolUseId?: string
      prompt?: string
      description?: string
      messageId?: string
      parentToolUseId?: string
    }
  | {
      type: 'token-usage'
      usage: {
        inputTokens?: number
        outputTokens?: number
        cacheReadTokens?: number
        cacheCreationTokens?: number
        cacheWriteTokens?: number
        reasoningTokens?: number
        contextWindow?: number
      }
      totalCostUsd?: number
      modelUsage?: Record<string, ClaudeCodeModelUsage>
      messageId?: string
      parentToolUseId?: string
    }
  // B9: assistant-level error classification (authentication_failed, billing_error, rate_limit, etc.)
  | {
      type: 'assistant-error'
      errorType: string
      messageId?: string
      parentToolUseId?: string
    }
  // B10: stop reason + result subtype/details from result message
  | {
      type: 'result-complete'
      stopReason?: string | null
      numTurns?: number
      durationMs?: number
      durationApiMs?: number
      subtype?: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries' | string
      isError?: boolean
      errors?: string[]
      permissionDenials?: ClaudeCodePermissionDenial[]
      parentToolUseId?: string
    }
  // Structured output from SDK result when outputFormat is enabled.
  | { type: 'structured-output'; data: unknown; parentToolUseId?: string }
  | { type: 'error'; message: string; code?: string; parentToolUseId?: string }
  | {
      type: 'task-started'
      taskId: string
      toolUseId?: string
      description: string
      taskType?: string
      parentToolUseId?: string
    }
  | {
      type: 'task-progress'
      taskId: string
      toolUseId?: string
      description: string
      usage?: {
        totalTokens: number
        toolUses: number
        durationMs: number
      }
      lastToolName?: string
      parentToolUseId?: string
    }
  | {
      type: 'task-notification'
      taskId: string
      toolUseId?: string
      status: 'completed' | 'failed' | 'stopped'
      summary: string
      outputFile?: string
      usage?: {
        totalTokens: number
        toolUses: number
        durationMs: number
      }
      parentToolUseId?: string
    }
  | {
      type: 'tool-use-summary'
      summary: string
      precedingToolUseIds: string[]
      parentToolUseId?: string
    }
  | {
      type: 'files-persisted'
      files: Array<{ filename: string; fileId: string }>
      failed: Array<{ filename: string; error: string }>
      parentToolUseId?: string
    }
  | {
      type: 'status-update'
      status: 'compacting' | null
      permissionMode?: string
      parentToolUseId?: string
    }
  | {
      type: 'hook-started'
      hookId: string
      hookName: string
      hookEvent: string
      parentToolUseId?: string
    }
  | {
      type: 'hook-progress'
      hookId: string
      hookName: string
      hookEvent: string
      output: string
      parentToolUseId?: string
    }
  | {
      type: 'hook-response'
      hookId: string
      hookName: string
      hookEvent: string
      output: string
      outcome: 'success' | 'error' | 'cancelled'
      exitCode?: number
      parentToolUseId?: string
    }
  | {
      type: 'rate-limit-info'
      data: unknown
      parentToolUseId?: string
    }
  | {
      type: 'prompt-suggestion'
      suggestion: string
      parentToolUseId?: string
    }
  | {
      type: 'auth-status'
      isAuthenticating: boolean
      output: string[]
      error?: string
      parentToolUseId?: string
    }

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
// CODEX types are extracted to ./types/codex.ts (re-exported below)
// ============================================================================

// Feature 21: File Attachment (for @ tagging in prompt and image attachments)
export type FileAttachment = {
  path: string
  isDirectory: boolean
  // Image support fields (Phase 4)
  mimeType?: string // e.g., "image/png", "image/jpeg"
  base64Data?: string // Base64 encoded image data from mobile
}

// ============================================================================
// SUBSCRIPTION USAGE TYPES
// ============================================================================

export type UsageWindow = {
  usedPercent: number // 0-100
  resetsAt: number | null // Unix timestamp (seconds)
  windowSeconds: number // Window duration in seconds
}

export type ExtraUsage = {
  isEnabled: boolean
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null // 0-100
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

export type { CodexAgentStatus, CodexAppInfo, CodexCollabAgentInteractionBeginEvent, CodexCollabAgentInteractionEndEvent, CodexCollabAgentSpawnBeginEvent, CodexCollabAgentSpawnEndEvent, CodexCollabCloseBeginEvent, CodexCollabCloseEndEvent, CodexCollabResumeBeginEvent, CodexCollabResumeEndEvent, CodexCollabWaitingBeginEvent, CodexCollabWaitingEndEvent, CodexModeKind, CodexPersonality, CodexPrompt, CodexRemoteSkill, CodexStreamMessage, CodexThread, CodexTranscriptDiff, CodexTranscriptMessage, CodexTranscriptToolCall, CodexWebSearchMode } from './types/codex'

export type { PiCommandPayload, PiForkMessagePayload, PiModelPayload, PiSessionInfo, PiStatePayload, PiStreamMessage } from './types/pi'
