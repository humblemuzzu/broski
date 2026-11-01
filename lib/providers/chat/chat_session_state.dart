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

// ─── Sealed base ─────────────────────────────────────────────────────────────

/// Base class for all chat session variants.
///
/// Shared fields (non-agent-specific) live here.
/// Agent-specific fields live only on the correct subclass.
///
/// Subclasses:
///   [ClaudeCodeChatState] — Claude Code
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
    this.projectPath,
    this.messages = const [],
    this.permissions = const [],
    this.sessionDiffs = const [],
    this.todos = const [],
    this.isCompacting = false,
    this.sessionStatus = const SessionStatus.idle(),
    this.pendingQuestion,
    this.contentLength = 0,
  });

  // --- Shared fields ---
  final String? projectPath;
  final List<ChatMessage> messages;
  final List<PermissionRequest> permissions;
  final List<DiffEntry> sessionDiffs;
  final List<Todo> todos;
  final bool isCompacting;
  final SessionStatus sessionStatus;
  final QuestionRequest? pendingQuestion;
  final int contentLength;

  // --- Abstract interface ---

  /// Which agent is running.
  AgentType get agentType;

  /// The session/thread ID for this backend.
  String? get effectiveSessionId;

  /// Working directory / project root.
  String? get effectivePath;

  // --- Convenience getters (backward compat) ---

  /// @deprecated Use `state is ClaudeCodeChatState` instead.
  bool get isClaudeCode => this is ClaudeCodeChatState;

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

  // --- Polymorphic copyWith (shared fields only) ---
  ChatSessionState copyWith({
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
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
  });
}

// Helper for sentinel resolution
T? _resolve<T>(Object? value, T? current) =>
    identical(value, _absent) ? current : value as T?;

// ─── ClaudeCode ──────────────────────────────────────────────────────────────

final class ClaudeCodeChatState extends ChatSessionState {
  const ClaudeCodeChatState({
    super.projectPath,
    super.messages,
    super.permissions,
    super.sessionDiffs,
    super.todos,
    super.isCompacting,
    super.sessionStatus,
    super.pendingQuestion,
    super.contentLength,
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
    String? projectPath,
    List<ChatMessage>? messages,
    List<PermissionRequest>? permissions,
    List<DiffEntry>? sessionDiffs,
    List<Todo>? todos,
    bool? isCompacting,
    SessionStatus? sessionStatus,
    Object? pendingQuestion = _absent,
    int? contentLength,
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
  }) {
    return ClaudeCodeChatState(
      projectPath: projectPath ?? this.projectPath,
      messages: messages ?? this.messages,
      permissions: permissions ?? this.permissions,
      sessionDiffs: sessionDiffs ?? this.sessionDiffs,
      todos: todos ?? this.todos,
      isCompacting: isCompacting ?? this.isCompacting,
      sessionStatus: sessionStatus ?? this.sessionStatus,
      pendingQuestion: _resolve<QuestionRequest>(
        pendingQuestion,
        this.pendingQuestion,
      ),
      contentLength: contentLength ?? this.contentLength,
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
