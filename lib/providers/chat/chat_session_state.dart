part of '../chat_provider.dart';

/// MCP OAuth pending state (SDK v1.1.23+)
/// When MCP OAuth browser open fails (headless/remote), we store the URL
/// for the user to manually open.
class McpOAuthPending {
  const McpOAuthPending({required this.serverName, required this.url});
  final String serverName;
  final String url;
}

class ChatSessionState {
  const ChatSessionState({
    this.session,
    this.projectPath,
    this.messages = const [],
    this.permissions = const [],
    this.sessionDiffs = const [],
    this.todos = const [],
    this.vcsInfo,
    this.isCompacting = false,
    this.sessionStatus =
        const SessionStatus.idle(), // Feature 13: Session status
    // Claude Code support
    this.isClaudeCode = false,
    this.ccSessionId,
    this.ccCwd,
    this.ccModel,
    this.ccInit,
    this.ccTokenUsage,
    this.ccStructuredOutput,
    this.ccIsStreaming = false,
    // Codex support
    this.isCodex = false,
    this.cxThreadId,
    this.cxCwd,
    this.cxModel,
    this.cxTokenUsage,
    this.cxIsStreaming = false,
    // Codex multi-agent collaboration tree (SDK v0.87.0+)
    this.cxCollabTree,
    // Codex request_user_input (SDK v0.87.0+)
    this.cxPendingUserInput,
    this.pendingQuestion,
    // FIX: Track content length incrementally instead of recalculating every frame
    this.contentLength = 0,
    // OpenCode Plan Mode (SDK v1.1.18+)
    // "build" = default mode for making changes
    // "plan" = research/planning mode (restricted file edits)
    this.ocAgentMode = 'build',
    // OpenCode MCP OAuth pending (SDK v1.1.23+)
    this.mcpOAuthPending,
    // Claude Code client-side message queue
    // When CC is streaming and user sends, we hold the message locally
    // and auto-send when the turn completes (ccIsStreaming → false).
    this.pendingCCMessage,
    this.pendingCCAttachments,
    // Pi support
    this.isPi = false,
    this.piSessionId,
    this.piCwd,
    this.piModel,
    this.piModelData,
    this.piThinkingLevel,
    this.piIsStreaming = false,
  });

  final SessionSummary? session;
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;
  final List<DiffEntry> sessionDiffs;
  final List<Todo> todos;
  final VcsInfo? vcsInfo; // Feature 10: Git branch info
  final bool isCompacting; // Feature 9: Compaction in progress
  final SessionStatus
  sessionStatus; // Feature 13: Session status (idle/busy/retry)

  // Claude Code support
  final bool isClaudeCode;
  final String? ccSessionId;
  final String? ccCwd;
  final String? ccModel;
  final CCSessionInit? ccInit;
  final CCTokenUsage? ccTokenUsage;
  final dynamic ccStructuredOutput;
  final bool ccIsStreaming;

  // Codex support
  final bool isCodex;
  final String? cxThreadId;
  final String? cxCwd;
  final String? cxModel;
  final CodexThreadTokenUsage? cxTokenUsage;
  final bool cxIsStreaming;
  // Codex multi-agent collaboration tree (SDK v0.87.0+)
  final CodexCollabAgentTree? cxCollabTree;
  // Codex request_user_input (SDK v0.87.0+)
  final CodexUserInputRequest? cxPendingUserInput;

  // OpenCode Question tool support
  final QuestionRequest? pendingQuestion;

  // FIX: Pre-computed content length for efficient auto-scroll detection
  final int contentLength;

  // OpenCode Plan Mode (SDK v1.1.18+)
  // "build" = default mode for making changes
  // "plan" = research/planning mode (restricted file edits)
  final String ocAgentMode;

  // OpenCode MCP OAuth pending (SDK v1.1.23+)
  // When MCP OAuth browser open fails in headless mode, URL stored here
  final McpOAuthPending? mcpOAuthPending;

  // Claude Code client-side message queue
  // Held locally while CC is streaming, auto-sent when turn completes.
  final String? pendingCCMessage;
  final List<FileAttachment>? pendingCCAttachments;

  // Pi support
  final bool isPi;
  final String? piSessionId;
  final String? piCwd;
  final String? piModel;
  final PiModel? piModelData;
  final PiThinkingLevel? piThinkingLevel;
  final bool piIsStreaming;

  /// Get the effective session ID (works for all backends)
  String? get effectiveSessionId => isClaudeCode
      ? ccSessionId
      : isCodex
      ? cxThreadId
      : isPi
      ? piSessionId
      : session?.id;

  /// Get the effective project path (works for all backends)
  String? get effectivePath => isClaudeCode
      ? ccCwd
      : isCodex
      ? cxCwd
      : isPi
      ? piCwd
      : projectPath;

  ChatSessionState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    VcsInfo? vcsInfo,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    bool? isClaudeCode,
    String? ccSessionId,
    String? ccCwd,
    String? ccModel,
    CCSessionInit? ccInit,
    CCTokenUsage? ccTokenUsage,
    dynamic ccStructuredOutput,
    bool? ccIsStreaming,
    bool? isCodex,
    String? cxThreadId,
    String? cxCwd,
    String? cxModel,
    CodexThreadTokenUsage? cxTokenUsage,
    bool? cxIsStreaming,
    CodexCollabAgentTree? cxCollabTree,
    CodexUserInputRequest? cxPendingUserInput,
    QuestionRequest? pendingQuestion,
    int? contentLength,
    String? ocAgentMode,
    McpOAuthPending? mcpOAuthPending,
    String? pendingCCMessage,
    List<FileAttachment>? pendingCCAttachments,
    bool? isPi,
    String? piSessionId,
    String? piCwd,
    String? piModel,
    PiModel? piModelData,
    PiThinkingLevel? piThinkingLevel,
    bool? piIsStreaming,
  }) {
    return ChatSessionState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: vcsInfo ?? this.vcsInfo,
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      isClaudeCode: isClaudeCode ?? this.isClaudeCode,
      ccSessionId: ccSessionId ?? this.ccSessionId,
      ccCwd: ccCwd ?? this.ccCwd,
      ccModel: ccModel ?? this.ccModel,
      ccInit: ccInit ?? this.ccInit,
      ccTokenUsage: ccTokenUsage ?? this.ccTokenUsage,
      ccStructuredOutput: ccStructuredOutput ?? this.ccStructuredOutput,
      ccIsStreaming: ccIsStreaming ?? this.ccIsStreaming,
      isCodex: isCodex ?? this.isCodex,
      cxThreadId: cxThreadId ?? this.cxThreadId,
      cxCwd: cxCwd ?? this.cxCwd,
      cxModel: cxModel ?? this.cxModel,
      cxTokenUsage: cxTokenUsage ?? this.cxTokenUsage,
      cxIsStreaming: cxIsStreaming ?? this.cxIsStreaming,
      cxCollabTree: cxCollabTree ?? this.cxCollabTree,
      cxPendingUserInput: cxPendingUserInput ?? this.cxPendingUserInput,
      pendingQuestion: pendingQuestion ?? this.pendingQuestion,
      contentLength: contentLength ?? this.contentLength,
      ocAgentMode: ocAgentMode ?? this.ocAgentMode,
      mcpOAuthPending: mcpOAuthPending ?? this.mcpOAuthPending,
      pendingCCMessage: pendingCCMessage ?? this.pendingCCMessage,
      pendingCCAttachments: pendingCCAttachments ?? this.pendingCCAttachments,
      isPi: isPi ?? this.isPi,
      piSessionId: piSessionId ?? this.piSessionId,
      piCwd: piCwd ?? this.piCwd,
      piModel: piModel ?? this.piModel,
      piModelData: piModelData ?? this.piModelData,
      piThinkingLevel: piThinkingLevel ?? this.piThinkingLevel,
      piIsStreaming: piIsStreaming ?? this.piIsStreaming,
    );
  }
}
