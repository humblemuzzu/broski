part of '../chat_provider.dart';

// ─── Sentinel for null-clearing in copyWith ─────────────────────────────────
//
// Problem: `field ?? this.field` means passing null to copyWith is ignored.
// Solution: Use a sentinel as the default. Distinguish "not passed" from "null".
//
//   copyWith(pendingQuestion: null)  → clear to null   ✅
//   copyWith()                       → keep current    ✅
//
const Object _absent = _Absent();

final class _Absent {
  const _Absent();
}

// ─── McpOAuthPending ─────────────────────────────────────────────────────────

/// MCP OAuth pending state (SDK v1.1.23+)
/// When MCP OAuth browser open fails (headless/remote), we store the URL
/// for the user to manually open.
class McpOAuthPending {
  const McpOAuthPending({required this.serverName, required this.url});
  final String serverName;
  final String url;
}

// ─── Sealed base ─────────────────────────────────────────────────────────────

/// Base class for all chat session variants.
///
/// Shared fields (non-agent-specific) live here.
/// Agent-specific fields live only on the correct subclass.
///
/// Subclasses:
///   [OpenCodeChatState]   — OpenCode / default
///   [ClaudeCodeChatState] — Claude Code
///   [CodexChatState]      — Codex
///   [PiChatState]         — Pi
///
/// Migration patterns:
///   - `state.isClaudeCode` → `state is ClaudeCodeChatState`
///   - `state.ccModel` → `(state as ClaudeCodeChatState).ccModel`
///     or better: `if (state case ClaudeCodeChatState s) s.ccModel`
///   - `state.effectiveSessionId` works on any subclass (no ternary chain)
///   - `state.agentType` replaces `isClaudeCode ? AgentType.claudeCode : ...`
///   - `state.copyWith(messages: m)` works on any subclass (shared fields)
///   - `state.copyWith(ccModel: x)` requires narrowing to ClaudeCodeChatState
sealed class ChatSessionState {
  const ChatSessionState({
    this.session,
    this.projectPath,
    this.messages = const [],
    this.permissions = const [],
    this.sessionDiffs = const [],
    this.todos = const [],
    this.vcsInfo,
    this.isCompacting = false,
    this.sessionStatus = const SessionStatus.idle(),
    this.pendingQuestion,
    this.contentLength = 0,
    this.mcpOAuthPending,
  });

  // --- Shared fields ---
  final SessionSummary? session;
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;
  final List<DiffEntry> sessionDiffs;
  final List<Todo> todos;
  final VcsInfo? vcsInfo;
  final bool isCompacting;
  final SessionStatus sessionStatus;
  final QuestionRequest? pendingQuestion;
  final int contentLength;
  final McpOAuthPending? mcpOAuthPending;

  // --- Abstract interface ---

  /// Which agent is running. Replaces isClaudeCode/isCodex/isPi checks.
  AgentType get agentType;

  /// The session/thread ID for this backend.
  String? get effectiveSessionId;

  /// Working directory / project root.
  String? get effectivePath;

  // --- Convenience getters (backward compat) ---

  /// @deprecated Use `state is ClaudeCodeChatState` instead.
  bool get isClaudeCode => this is ClaudeCodeChatState;

  /// @deprecated Use `state is CodexChatState` instead.
  bool get isCodex => this is CodexChatState;

  /// @deprecated Use `state is PiChatState` instead.
  bool get isPi => this is PiChatState;

  /// @deprecated Use `state is OpenCodeChatState` instead.
  bool get isOpenCode => this is OpenCodeChatState;

  // --- Agent-specific field accessors (backward compat, nullable) ---
  // These allow gradual migration. Access returns null if wrong subclass.

  String? get ccSessionId => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).ccSessionId
      : null;
  String? get ccCwd =>
      this is ClaudeCodeChatState ? (this as ClaudeCodeChatState).ccCwd : null;
  String? get ccModel => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).ccModel
      : null;
  CCSessionInit? get ccInit =>
      this is ClaudeCodeChatState ? (this as ClaudeCodeChatState).ccInit : null;
  CCTokenUsage? get ccTokenUsage => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).ccTokenUsage
      : null;
  dynamic get ccStructuredOutput => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).ccStructuredOutput
      : null;
  bool get ccIsStreaming => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).ccIsStreaming
      : false;
  String? get pendingCCMessage => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).pendingCCMessage
      : null;
  List<FileAttachment>? get pendingCCAttachments => this is ClaudeCodeChatState
      ? (this as ClaudeCodeChatState).pendingCCAttachments
      : null;

  String? get cxThreadId =>
      this is CodexChatState ? (this as CodexChatState).cxThreadId : null;
  String? get cxCwd =>
      this is CodexChatState ? (this as CodexChatState).cxCwd : null;
  String? get cxModel =>
      this is CodexChatState ? (this as CodexChatState).cxModel : null;
  CodexThreadTokenUsage? get cxTokenUsage =>
      this is CodexChatState ? (this as CodexChatState).cxTokenUsage : null;
  bool get cxIsStreaming =>
      this is CodexChatState ? (this as CodexChatState).cxIsStreaming : false;
  CodexCollabAgentTree? get cxCollabTree =>
      this is CodexChatState ? (this as CodexChatState).cxCollabTree : null;
  CodexUserInputRequest? get cxPendingUserInput => this is CodexChatState
      ? (this as CodexChatState).cxPendingUserInput
      : null;

  String get ocAgentMode => this is OpenCodeChatState
      ? (this as OpenCodeChatState).ocAgentMode
      : 'build';

  String? get piSessionId =>
      this is PiChatState ? (this as PiChatState).piSessionId : null;
  String? get piCwd => this is PiChatState ? (this as PiChatState).piCwd : null;
  String? get piModel =>
      this is PiChatState ? (this as PiChatState).piModel : null;
  PiModel? get piModelData =>
      this is PiChatState ? (this as PiChatState).piModelData : null;
  PiThinkingLevel? get piThinkingLevel =>
      this is PiChatState ? (this as PiChatState).piThinkingLevel : null;
  bool get piIsStreaming =>
      this is PiChatState ? (this as PiChatState).piIsStreaming : false;

  // --- Polymorphic copyWith (shared fields only) ---
  ChatSessionState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    Object? vcsInfo = _absent,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
    Object? mcpOAuthPending = _absent,
    // Backward compat: agent-specific fields passed through.
    // These only take effect if the state is the right subclass.
    // New code should narrow with `if (state case FooState s) s.copyWith(...)`.
    bool? isClaudeCode,
    Object? ccSessionId = _absent,
    String? ccCwd,
    Object? ccModel = _absent,
    Object? ccInit = _absent,
    Object? ccTokenUsage = _absent,
    Object? ccStructuredOutput = _absent,
    bool? ccIsStreaming,
    Object? pendingCCMessage = _absent,
    Object? pendingCCAttachments = _absent,
    bool? isCodex,
    Object? cxThreadId = _absent,
    String? cxCwd,
    Object? cxModel = _absent,
    Object? cxTokenUsage = _absent,
    bool? cxIsStreaming,
    Object? cxCollabTree = _absent,
    Object? cxPendingUserInput = _absent,
    String? ocAgentMode,
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
  });
}

// Helper for sentinel resolution
T? _resolve<T>(Object? value, T? current) =>
    identical(value, _absent) ? current : value as T?;

// ─── OpenCode ────────────────────────────────────────────────────────────────

final class OpenCodeChatState extends ChatSessionState {
  const OpenCodeChatState({
    super.session,
    super.projectPath,
    super.messages,
    super.permissions,
    super.sessionDiffs,
    super.todos,
    super.vcsInfo,
    super.isCompacting,
    super.sessionStatus,
    super.pendingQuestion,
    super.contentLength,
    super.mcpOAuthPending,
    this.ocAgentMode = 'build',
  });

  @override
  final String ocAgentMode;

  @override
  AgentType get agentType => AgentType.opencode;
  @override
  String? get effectiveSessionId => session?.id;
  @override
  String? get effectivePath => projectPath;

  @override
  OpenCodeChatState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    Object? vcsInfo = _absent,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
    Object? mcpOAuthPending = _absent,
    // OC-specific
    String? ocAgentMode,
    // Ignored (wrong subclass)
    bool? isClaudeCode,
    Object? ccSessionId = _absent,
    String? ccCwd,
    Object? ccModel = _absent,
    Object? ccInit = _absent,
    Object? ccTokenUsage = _absent,
    Object? ccStructuredOutput = _absent,
    bool? ccIsStreaming,
    Object? pendingCCMessage = _absent,
    Object? pendingCCAttachments = _absent,
    bool? isCodex,
    Object? cxThreadId = _absent,
    String? cxCwd,
    Object? cxModel = _absent,
    Object? cxTokenUsage = _absent,
    bool? cxIsStreaming,
    Object? cxCollabTree = _absent,
    Object? cxPendingUserInput = _absent,
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
  }) {
    return OpenCodeChatState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: _resolve<VcsInfo>(vcsInfo, this.vcsInfo),
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      pendingQuestion: _resolve<QuestionRequest>(
        pendingQuestion,
        this.pendingQuestion,
      ),
      contentLength: contentLength ?? this.contentLength,
      mcpOAuthPending: _resolve<McpOAuthPending>(
        mcpOAuthPending,
        this.mcpOAuthPending,
      ),
      ocAgentMode: ocAgentMode ?? this.ocAgentMode,
    );
  }
}

// ─── ClaudeCode ──────────────────────────────────────────────────────────────

final class ClaudeCodeChatState extends ChatSessionState {
  const ClaudeCodeChatState({
    super.session,
    super.projectPath,
    super.messages,
    super.permissions,
    super.sessionDiffs,
    super.todos,
    super.vcsInfo,
    super.isCompacting,
    super.sessionStatus,
    super.pendingQuestion,
    super.contentLength,
    super.mcpOAuthPending,
    this.ccSessionId,
    this.ccCwd,
    this.ccModel,
    this.ccInit,
    this.ccTokenUsage,
    this.ccStructuredOutput,
    this.ccIsStreaming = false,
    this.pendingCCMessage,
    this.pendingCCAttachments,
  });

  @override
  final String? ccSessionId;
  @override
  final String? ccCwd;
  @override
  final String? ccModel;
  @override
  final CCSessionInit? ccInit;
  @override
  final CCTokenUsage? ccTokenUsage;
  @override
  final dynamic ccStructuredOutput;
  @override
  final bool ccIsStreaming;
  @override
  final String? pendingCCMessage;
  @override
  final List<FileAttachment>? pendingCCAttachments;

  @override
  AgentType get agentType => AgentType.claudeCode;
  @override
  String? get effectiveSessionId => ccSessionId;
  @override
  String? get effectivePath => ccCwd;

  @override
  ClaudeCodeChatState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    Object? vcsInfo = _absent,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
    Object? mcpOAuthPending = _absent,
    // CC-specific
    bool? isClaudeCode,
    Object? ccSessionId = _absent,
    String? ccCwd,
    Object? ccModel = _absent,
    Object? ccInit = _absent,
    Object? ccTokenUsage = _absent,
    Object? ccStructuredOutput = _absent,
    bool? ccIsStreaming,
    Object? pendingCCMessage = _absent,
    Object? pendingCCAttachments = _absent,
    // Ignored (wrong subclass)
    bool? isCodex,
    Object? cxThreadId = _absent,
    String? cxCwd,
    Object? cxModel = _absent,
    Object? cxTokenUsage = _absent,
    bool? cxIsStreaming,
    Object? cxCollabTree = _absent,
    Object? cxPendingUserInput = _absent,
    String? ocAgentMode,
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
  }) {
    return ClaudeCodeChatState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: _resolve<VcsInfo>(vcsInfo, this.vcsInfo),
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      pendingQuestion: _resolve<QuestionRequest>(
        pendingQuestion,
        this.pendingQuestion,
      ),
      contentLength: contentLength ?? this.contentLength,
      mcpOAuthPending: _resolve<McpOAuthPending>(
        mcpOAuthPending,
        this.mcpOAuthPending,
      ),
      ccSessionId: _resolve<String>(ccSessionId, this.ccSessionId),
      ccCwd: ccCwd ?? this.ccCwd,
      ccModel: _resolve<String>(ccModel, this.ccModel),
      ccInit: _resolve<CCSessionInit>(ccInit, this.ccInit),
      ccTokenUsage: _resolve<CCTokenUsage>(ccTokenUsage, this.ccTokenUsage),
      ccStructuredOutput: identical(ccStructuredOutput, _absent)
          ? this.ccStructuredOutput
          : ccStructuredOutput,
      ccIsStreaming: ccIsStreaming ?? this.ccIsStreaming,
      pendingCCMessage: _resolve<String>(
        pendingCCMessage,
        this.pendingCCMessage,
      ),
      pendingCCAttachments: _resolve<List<FileAttachment>>(
        pendingCCAttachments,
        this.pendingCCAttachments,
      ),
    );
  }
}

// ─── Codex ───────────────────────────────────────────────────────────────────

final class CodexChatState extends ChatSessionState {
  const CodexChatState({
    super.session,
    super.projectPath,
    super.messages,
    super.permissions,
    super.sessionDiffs,
    super.todos,
    super.vcsInfo,
    super.isCompacting,
    super.sessionStatus,
    super.pendingQuestion,
    super.contentLength,
    super.mcpOAuthPending,
    this.cxThreadId,
    this.cxCwd,
    this.cxModel,
    this.cxTokenUsage,
    this.cxIsStreaming = false,
    this.cxCollabTree,
    this.cxPendingUserInput,
  });

  @override
  final String? cxThreadId;
  @override
  final String? cxCwd;
  @override
  final String? cxModel;
  @override
  final CodexThreadTokenUsage? cxTokenUsage;
  @override
  final bool cxIsStreaming;
  @override
  final CodexCollabAgentTree? cxCollabTree;
  @override
  final CodexUserInputRequest? cxPendingUserInput;

  @override
  AgentType get agentType => AgentType.codex;
  @override
  String? get effectiveSessionId => cxThreadId;
  @override
  String? get effectivePath => cxCwd;

  @override
  CodexChatState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    Object? vcsInfo = _absent,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
    Object? mcpOAuthPending = _absent,
    // CX-specific
    bool? isCodex,
    Object? cxThreadId = _absent,
    String? cxCwd,
    Object? cxModel = _absent,
    Object? cxTokenUsage = _absent,
    bool? cxIsStreaming,
    Object? cxCollabTree = _absent,
    Object? cxPendingUserInput = _absent,
    // Ignored (wrong subclass)
    bool? isClaudeCode,
    Object? ccSessionId = _absent,
    String? ccCwd,
    Object? ccModel = _absent,
    Object? ccInit = _absent,
    Object? ccTokenUsage = _absent,
    Object? ccStructuredOutput = _absent,
    bool? ccIsStreaming,
    Object? pendingCCMessage = _absent,
    Object? pendingCCAttachments = _absent,
    String? ocAgentMode,
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
  }) {
    return CodexChatState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: _resolve<VcsInfo>(vcsInfo, this.vcsInfo),
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      pendingQuestion: _resolve<QuestionRequest>(
        pendingQuestion,
        this.pendingQuestion,
      ),
      contentLength: contentLength ?? this.contentLength,
      mcpOAuthPending: _resolve<McpOAuthPending>(
        mcpOAuthPending,
        this.mcpOAuthPending,
      ),
      cxThreadId: _resolve<String>(cxThreadId, this.cxThreadId),
      cxCwd: cxCwd ?? this.cxCwd,
      cxModel: _resolve<String>(cxModel, this.cxModel),
      cxTokenUsage: _resolve<CodexThreadTokenUsage>(
        cxTokenUsage,
        this.cxTokenUsage,
      ),
      cxIsStreaming: cxIsStreaming ?? this.cxIsStreaming,
      cxCollabTree: _resolve<CodexCollabAgentTree>(
        cxCollabTree,
        this.cxCollabTree,
      ),
      cxPendingUserInput: _resolve<CodexUserInputRequest>(
        cxPendingUserInput,
        this.cxPendingUserInput,
      ),
    );
  }
}

// ─── Pi ──────────────────────────────────────────────────────────────────────

final class PiChatState extends ChatSessionState {
  const PiChatState({
    super.session,
    super.projectPath,
    super.messages,
    super.permissions,
    super.sessionDiffs,
    super.todos,
    super.vcsInfo,
    super.isCompacting,
    super.sessionStatus,
    super.pendingQuestion,
    super.contentLength,
    super.mcpOAuthPending,
    this.piSessionId,
    this.piCwd,
    this.piModel,
    this.piModelData,
    this.piThinkingLevel,
    this.piIsStreaming = false,
  });

  @override
  final String? piSessionId;
  @override
  final String? piCwd;
  @override
  final String? piModel;
  @override
  final PiModel? piModelData;
  @override
  final PiThinkingLevel? piThinkingLevel;
  @override
  final bool piIsStreaming;

  @override
  AgentType get agentType => AgentType.pi;
  @override
  String? get effectiveSessionId => piSessionId;
  @override
  String? get effectivePath => piCwd;

  @override
  PiChatState copyWith({
    SessionSummary? session,
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    Object? vcsInfo = _absent,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
    Object? mcpOAuthPending = _absent,
    // Pi-specific
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
    // Ignored (wrong subclass)
    bool? isClaudeCode,
    Object? ccSessionId = _absent,
    String? ccCwd,
    Object? ccModel = _absent,
    Object? ccInit = _absent,
    Object? ccTokenUsage = _absent,
    Object? ccStructuredOutput = _absent,
    bool? ccIsStreaming,
    Object? pendingCCMessage = _absent,
    Object? pendingCCAttachments = _absent,
    bool? isCodex,
    Object? cxThreadId = _absent,
    String? cxCwd,
    Object? cxModel = _absent,
    Object? cxTokenUsage = _absent,
    bool? cxIsStreaming,
    Object? cxCollabTree = _absent,
    Object? cxPendingUserInput = _absent,
    String? ocAgentMode,
  }) {
    return PiChatState(
      session: session ?? this.session,
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      vcsInfo: _resolve<VcsInfo>(vcsInfo, this.vcsInfo),
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      pendingQuestion: _resolve<QuestionRequest>(
        pendingQuestion,
        this.pendingQuestion,
      ),
      contentLength: contentLength ?? this.contentLength,
      mcpOAuthPending: _resolve<McpOAuthPending>(
        mcpOAuthPending,
        this.mcpOAuthPending,
      ),
      piSessionId: _resolve<String>(piSessionId, this.piSessionId),
      piCwd: piCwd ?? this.piCwd,
      piModel: _resolve<String>(piModel, this.piModel),
      piModelData: _resolve<PiModel>(piModelData, this.piModelData),
      piThinkingLevel: _resolve<PiThinkingLevel>(
        piThinkingLevel,
        this.piThinkingLevel,
      ),
      piIsStreaming: piIsStreaming ?? this.piIsStreaming,
    );
  }
}
