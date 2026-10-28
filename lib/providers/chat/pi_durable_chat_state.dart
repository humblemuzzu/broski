part of '../chat_provider.dart';

// ─── Pi Durable ──────────────────────────────────────────────────────────────

/// Chat state for the durable Pi backend. Differs from [PiChatState] only in
/// identity: the session id is the bridge's durable session id, and the model /
/// thinking level ride along so `unified_set_model` and the header pill can be
/// rendered without a second read.
final class PiDurableChatState extends ChatSessionState {
  const PiDurableChatState({
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
    this.pdSessionId,
    this.pdCwd,
    this.pdModel,
    this.pdThinkingLevel,
    this.pdIsStreaming = false,
    this.pdResumeNotice,
    this.pdUsage,
    this.pdContextTokens,
  });

  final String? pdSessionId;
  final String? pdCwd;
  final String? pdModel;
  final PiThinkingLevel? pdThinkingLevel;
  final bool pdIsStreaming;

  /// Set from a `resumed` backend_event: work the Mac picked back up after a
  /// crash. Rendered as a dismissible banner instead of a transcript message.
  final String? pdResumeNotice;

  /// The bridge's `backendData.usage`: per-model token buckets and cost.
  final Map<String, dynamic>? pdUsage;

  /// The newest answer's prompt size from `backendData.contextTokens`, which
  /// together with the model catalog's context window forms the pill's %.
  final int? pdContextTokens;

  @override
  AgentType get agentType => AgentType.piDurable;
  @override
  String? get effectiveSessionId => pdSessionId;
  @override
  String? get effectivePath => pdCwd;

  @override
  PiDurableChatState copyWith({
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
    // Pi Durable-specific
    bool? isPiDurable,
    Object? pdSessionId = _absent,
    String? pdCwd,
    Object? pdModel = _absent,
    Object? pdThinkingLevel = _absent,
    bool? pdIsStreaming,
    Object? pdResumeNotice = _absent,
    Object? pdUsage = _absent,
    Object? pdContextTokens = _absent,
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
    Object? cxPendingUserInput = _absent,
    List<String>? cxQueuedMessages,
    String? ocAgentMode,
    bool? isPi,
    Object? piSessionId = _absent,
    String? piCwd,
    Object? piModel = _absent,
    Object? piModelData = _absent,
    Object? piThinkingLevel = _absent,
    bool? piIsStreaming,
  }) {
    return PiDurableChatState(
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
      pdSessionId: _resolve<String>(pdSessionId, this.pdSessionId),
      pdCwd: pdCwd ?? this.pdCwd,
      pdModel: _resolve<String>(pdModel, this.pdModel),
      pdThinkingLevel: _resolve<PiThinkingLevel>(
        pdThinkingLevel,
        this.pdThinkingLevel,
      ),
      pdIsStreaming: pdIsStreaming ?? this.pdIsStreaming,
      pdResumeNotice: _resolve<String>(pdResumeNotice, this.pdResumeNotice),
      pdUsage: _resolve<Map<String, dynamic>>(pdUsage, this.pdUsage),
      pdContextTokens: _resolve<int>(pdContextTokens, this.pdContextTokens),
    );
  }
}

/// Read-side access to [PiDurableChatState] through the sealed base, so the
/// backend-agnostic reducers never need to narrow by hand.
extension PiDurableChatStateAccess on ChatSessionState {
  bool get isPiDurable => this is PiDurableChatState;

  String? get pdSessionId => this is PiDurableChatState
      ? (this as PiDurableChatState).pdSessionId
      : null;
  String? get pdCwd =>
      this is PiDurableChatState ? (this as PiDurableChatState).pdCwd : null;
  String? get pdModel =>
      this is PiDurableChatState ? (this as PiDurableChatState).pdModel : null;
  PiThinkingLevel? get pdThinkingLevel => this is PiDurableChatState
      ? (this as PiDurableChatState).pdThinkingLevel
      : null;
  bool get pdIsStreaming => this is PiDurableChatState
      ? (this as PiDurableChatState).pdIsStreaming
      : false;
  String? get pdResumeNotice => this is PiDurableChatState
      ? (this as PiDurableChatState).pdResumeNotice
      : null;

  Map<String, dynamic>? get pdUsage =>
      this is PiDurableChatState ? (this as PiDurableChatState).pdUsage : null;

  int? get pdContextTokens => this is PiDurableChatState
      ? (this as PiDurableChatState).pdContextTokens
      : null;
}
