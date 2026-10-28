import 'package:broski/models/session.dart' show SessionSummaryStats;
import 'package:broski/utils/ansi_escape.dart';

/// A custom prompt from `.codex/prompts/` (project) or `$CODEX_HOME/prompts/` (user).
///
/// These are Markdown files with optional YAML frontmatter (description, argument-hint).
class CodexPrompt {
  final String name;
  final String? description;
  final String? argumentHint;
  final String content;
  final String path;
  final String source; // 'project' or 'user'

  const CodexPrompt({
    required this.name,
    this.description,
    this.argumentHint,
    required this.content,
    required this.path,
    required this.source,
  });

  factory CodexPrompt.fromJson(Map<String, dynamic> json) {
    return CodexPrompt(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      argumentHint: json['argumentHint'] as String?,
      content: json['content'] as String? ?? '',
      path: json['path'] as String? ?? '',
      source: json['source'] as String? ?? 'project',
    );
  }

  Map<String, dynamic> toJson() => {
    'name': name,
    if (description != null) 'description': description,
    if (argumentHint != null) 'argumentHint': argumentHint,
    'content': content,
    'path': path,
    'source': source,
  };

  bool get isProject => source == 'project';

  bool get isUser => source == 'user';

  String get displayName => '/$name';
}

/// A model returned by the Codex `model/list` JSON-RPC endpoint.
///
/// Mirrors the SDK `Model` type from `app-server-protocol/schema/typescript/v2/Model.ts`.
class CodexModel {
  final String id;
  final String model;
  final String? upgrade;
  final String displayName;
  final String description;
  final bool isDefault;
  final bool supportsPersonality;
  final List<String> supportedReasoningEfforts;
  final String defaultReasoningEffort;
  final bool hidden;
  final List<String> inputModalities;
  final Map<String, dynamic>? upgradeInfo;
  final Map<String, dynamic>? availabilityNux;

  const CodexModel({
    required this.id,
    required this.model,
    this.upgrade,
    required this.displayName,
    required this.description,
    this.isDefault = false,
    this.supportsPersonality = false,
    this.supportedReasoningEfforts = const [],
    this.defaultReasoningEffort = 'medium',
    this.hidden = false,
    this.inputModalities = const ['text'],
    this.upgradeInfo,
    this.availabilityNux,
  });

  /// Whether this model supports image input.
  bool get supportsImages => inputModalities.contains('image');

  /// Whether this model has an upgrade path available.
  bool get hasUpgrade => upgradeInfo != null;

  /// The upgrade copy text (e.g., "Upgrade to o4-mini").
  String? get upgradeCopy => upgradeInfo?['upgradeCopy'] as String?;

  /// The model to upgrade to.
  String? get upgradeModel => upgradeInfo?['model'] as String?;

  factory CodexModel.fromJson(Map<String, dynamic> json) {
    return CodexModel(
      id: json['id'] as String? ?? json['model'] as String? ?? '',
      model: json['model'] as String? ?? json['id'] as String? ?? '',
      upgrade: json['upgrade'] as String?,
      displayName:
          json['displayName'] as String? ?? json['model'] as String? ?? '',
      description: json['description'] as String? ?? '',
      isDefault: json['isDefault'] as bool? ?? false,
      supportsPersonality: json['supportsPersonality'] as bool? ?? false,
      supportedReasoningEfforts:
          (json['supportedReasoningEfforts'] as List<dynamic>?)?.map((e) {
            if (e is Map<String, dynamic>) return e['effort'] as String? ?? '';
            return e.toString();
          }).toList() ??
          const [],
      defaultReasoningEffort:
          json['defaultReasoningEffort'] as String? ?? 'medium',
      hidden: json['hidden'] as bool? ?? false,
      inputModalities:
          (json['inputModalities'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const ['text'],
      upgradeInfo: json['upgradeInfo'] as Map<String, dynamic>?,
      availabilityNux: json['availabilityNux'] as Map<String, dynamic>?,
    );
  }
}

enum CodexApprovalPolicy {
  unlessTrusted,
  onFailure,
  onRequest,
  never;

  String get wireValue {
    switch (this) {
      case CodexApprovalPolicy.unlessTrusted:
        return 'untrusted';
      case CodexApprovalPolicy.onFailure:
        return 'on-failure';
      case CodexApprovalPolicy.onRequest:
        return 'on-request';
      case CodexApprovalPolicy.never:
        return 'never';
    }
  }

  String get displayName {
    switch (this) {
      case CodexApprovalPolicy.unlessTrusted:
        return 'Unless Trusted';
      case CodexApprovalPolicy.onFailure:
        return 'On Failure';
      case CodexApprovalPolicy.onRequest:
        return 'On Request';
      case CodexApprovalPolicy.never:
        return 'Full Access';
    }
  }
}

enum CodexReasoningEffort {
  none,
  minimal,
  low,
  medium,
  high,
  xhigh;

  String get wireValue {
    switch (this) {
      case CodexReasoningEffort.none:
        return 'none';
      case CodexReasoningEffort.minimal:
        return 'minimal';
      case CodexReasoningEffort.low:
        return 'low';
      case CodexReasoningEffort.medium:
        return 'medium';
      case CodexReasoningEffort.high:
        return 'high';
      case CodexReasoningEffort.xhigh:
        return 'xhigh';
    }
  }

  /// User-friendly display name for UI
  String get displayName {
    switch (this) {
      case CodexReasoningEffort.none:
        return 'None';
      case CodexReasoningEffort.minimal:
        return 'Minimal';
      case CodexReasoningEffort.low:
        return 'Low';
      case CodexReasoningEffort.medium:
        return 'Medium';
      case CodexReasoningEffort.high:
        return 'High';
      case CodexReasoningEffort.xhigh:
        return 'Extra High';
    }
  }
}

enum CodexReasoningSummary {
  auto,
  concise,
  detailed,
  none;

  String get wireValue {
    switch (this) {
      case CodexReasoningSummary.auto:
        return 'auto';
      case CodexReasoningSummary.concise:
        return 'concise';
      case CodexReasoningSummary.detailed:
        return 'detailed';
      case CodexReasoningSummary.none:
        return 'none';
    }
  }
}

enum CodexSandboxMode {
  readOnly,
  workspaceWrite,
  dangerFullAccess;

  /// `thread/start` expects kebab-case values.
  String get threadWireValue {
    switch (this) {
      case CodexSandboxMode.readOnly:
        return 'read-only';
      case CodexSandboxMode.workspaceWrite:
        return 'workspace-write';
      case CodexSandboxMode.dangerFullAccess:
        return 'danger-full-access';
    }
  }

  /// `turn/start` sandboxPolicy.type uses camelCase tags per app-server docs.
  String get policyType {
    switch (this) {
      case CodexSandboxMode.readOnly:
        return 'readOnly';
      case CodexSandboxMode.workspaceWrite:
        return 'workspaceWrite';
      case CodexSandboxMode.dangerFullAccess:
        return 'dangerFullAccess';
    }
  }
}

class CodexSettings {
  const CodexSettings({
    this.approvalPolicy = CodexApprovalPolicy.onRequest,
    this.sandboxMode = CodexSandboxMode.readOnly,
    this.networkAccessEnabled = false,
    this.reasoningEffort = CodexReasoningEffort.medium,
    this.reasoningSummary = CodexReasoningSummary.auto,
    this.webSearchMode = CodexWebSearchMode.disabled,
    this.skillsEnabled = false,
    this.collaborationMode = CodexCollaborationMode.defaultMode,
    this.personality = CodexPersonality.pragmatic,
    this.serviceTier = CodexServiceTier.fast,
  });

  final CodexApprovalPolicy approvalPolicy;
  final CodexSandboxMode sandboxMode;
  final bool networkAccessEnabled;
  final CodexReasoningEffort reasoningEffort;
  final CodexReasoningSummary reasoningSummary;
  final CodexWebSearchMode webSearchMode;
  final bool skillsEnabled;
  final CodexCollaborationMode collaborationMode;
  final CodexPersonality personality;
  final CodexServiceTier serviceTier;

  CodexSettings copyWith({
    CodexApprovalPolicy? approvalPolicy,
    CodexSandboxMode? sandboxMode,
    bool? networkAccessEnabled,
    CodexReasoningEffort? reasoningEffort,
    CodexReasoningSummary? reasoningSummary,
    CodexWebSearchMode? webSearchMode,
    bool? skillsEnabled,
    CodexCollaborationMode? collaborationMode,
    CodexPersonality? personality,
    CodexServiceTier? serviceTier,
  }) {
    return CodexSettings(
      approvalPolicy: approvalPolicy ?? this.approvalPolicy,
      sandboxMode: sandboxMode ?? this.sandboxMode,
      networkAccessEnabled: networkAccessEnabled ?? this.networkAccessEnabled,
      reasoningEffort: reasoningEffort ?? this.reasoningEffort,
      reasoningSummary: reasoningSummary ?? this.reasoningSummary,
      webSearchMode: webSearchMode ?? this.webSearchMode,
      skillsEnabled: skillsEnabled ?? this.skillsEnabled,
      collaborationMode: collaborationMode ?? this.collaborationMode,
      personality: personality ?? this.personality,
      serviceTier: serviceTier ?? this.serviceTier,
    );
  }

  factory CodexSettings.fromJson(Map<String, dynamic> json) {
    CodexApprovalPolicy parseApproval(String? v) {
      switch (v) {
        case 'untrusted':
        case 'unlessTrusted':
          return CodexApprovalPolicy.unlessTrusted;
        case 'on-failure':
        case 'onFailure':
          return CodexApprovalPolicy.onFailure;
        case 'never':
          return CodexApprovalPolicy.never;
        case 'on-request':
        case 'onRequest':
        default:
          return CodexApprovalPolicy.onRequest;
      }
    }

    CodexSandboxMode parseSandbox(String? v) {
      switch (v) {
        case 'workspace-write':
        case 'workspaceWrite':
          return CodexSandboxMode.workspaceWrite;
        case 'danger-full-access':
        case 'dangerFullAccess':
          return CodexSandboxMode.dangerFullAccess;
        case 'read-only':
        case 'readOnly':
        default:
          return CodexSandboxMode.readOnly;
      }
    }

    CodexReasoningEffort parseEffort(String? v) {
      switch (v) {
        case 'minimal':
          return CodexReasoningEffort.minimal;
        case 'low':
          return CodexReasoningEffort.low;
        case 'high':
          return CodexReasoningEffort.high;
        case 'xhigh':
          return CodexReasoningEffort.xhigh;
        case 'medium':
        default:
          return CodexReasoningEffort.medium;
      }
    }

    CodexReasoningSummary parseSummary(String? v) {
      switch (v) {
        case 'concise':
          return CodexReasoningSummary.concise;
        case 'detailed':
          return CodexReasoningSummary.detailed;
        case 'none':
          return CodexReasoningSummary.none;
        case 'auto':
        default:
          return CodexReasoningSummary.auto;
      }
    }

    return CodexSettings(
      approvalPolicy: parseApproval(json['approvalPolicy'] as String?),
      sandboxMode: parseSandbox(json['sandboxMode'] as String?),
      networkAccessEnabled: json['networkAccessEnabled'] == true,
      reasoningEffort: parseEffort(json['reasoningEffort'] as String?),
      reasoningSummary: parseSummary(json['reasoningSummary'] as String?),
      webSearchMode: () {
        // Migration: handle old boolean format
        final wsVal = json['webSearchMode'] ?? json['webSearchEnabled'];
        if (wsVal is bool) {
          return wsVal ? CodexWebSearchMode.live : CodexWebSearchMode.disabled;
        }
        return CodexWebSearchMode.fromString(wsVal?.toString());
      }(),
      skillsEnabled: json['skillsEnabled'] == true,
      collaborationMode: CodexCollaborationMode.fromString(
        json['collaborationMode'] as String?,
      ),
      personality: CodexPersonality.fromString(json['personality'] as String?),
      serviceTier: CodexServiceTier.fromWireValue(
        json['serviceTier'] as String? ?? 'fast',
      ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'approvalPolicy': approvalPolicy.wireValue,
      'sandboxMode': sandboxMode.policyType,
      'networkAccessEnabled': networkAccessEnabled,
      'reasoningEffort': reasoningEffort.wireValue,
      'reasoningSummary': reasoningSummary.wireValue,
      'webSearchMode': webSearchMode.wireValue,
      'skillsEnabled': skillsEnabled,
      'collaborationMode': collaborationMode.wireValue,
      'personality': personality.wireValue,
      'serviceTier': serviceTier.wireValue,
    };
  }
}

class CodexThreadStatus {
  const CodexThreadStatus({required this.type, this.activeFlags = const []});

  final String type;
  final List<String> activeFlags;

  factory CodexThreadStatus.fromJson(dynamic json) {
    if (json is! Map<String, dynamic>) {
      return const CodexThreadStatus(type: 'notLoaded');
    }
    final flags = (json['activeFlags'] as List<dynamic>? ?? const [])
        .map((f) => f.toString())
        .toList();
    return CodexThreadStatus(
      type: json['type'] as String? ?? 'notLoaded',
      activeFlags: flags,
    );
  }

  Map<String, dynamic> toJson() => {
    'type': type,
    if (activeFlags.isNotEmpty) 'activeFlags': activeFlags,
  };

  bool get isActive => type == 'active';
  bool get isWaitingOnApproval => activeFlags.contains('waitingOnApproval');
  bool get isWaitingOnUserInput => activeFlags.contains('waitingOnUserInput');
}

class CodexThread {
  final String id;
  final String? forkedFromId; // SDK mid-2026: source thread when forked
  final String preview;
  final String cwd;
  final int createdAt; // unix seconds
  final int updatedAt; // unix seconds (SDK v0.87.0+)
  final String? modelProvider;
  final String? cliVersion;
  final String? source;
  final String? gitBranch;
  final String? threadName; // SDK thread/name/set (mid-2026)
  final CodexThreadStatus? status; // SDK thread.status (mid-2026)
  final String? agentNickname; // SDK thread.agentNickname
  final String? agentRole; // SDK thread.agentRole
  final SessionSummaryStats?
  summary; // Code diff stats (additions/deletions/files)

  const CodexThread({
    required this.id,
    this.forkedFromId,
    required this.preview,
    required this.cwd,
    required this.createdAt,
    int? updatedAt,
    this.modelProvider,
    this.cliVersion,
    this.source,
    this.gitBranch,
    this.threadName,
    this.status,
    this.agentNickname,
    this.agentRole,
    this.summary,
  }) : updatedAt = updatedAt ?? createdAt;

  factory CodexThread.fromJson(Map<String, dynamic> json) {
    final gitInfo = json['gitInfo'] as Map<String, dynamic>?;
    final createdAt = json['createdAt'] as int? ?? 0;
    return CodexThread(
      id: json['id'] as String? ?? '',
      forkedFromId: json['forkedFromId'] as String?,
      preview: stripAnsi(json['preview'] as String? ?? ''),
      cwd: json['cwd'] as String? ?? '',
      createdAt: createdAt,
      updatedAt: json['updatedAt'] as int? ?? createdAt,
      modelProvider: json['modelProvider'] as String?,
      cliVersion: json['cliVersion'] as String?,
      source: json['source'] as String?,
      gitBranch: gitInfo?['branch'] as String?,
      threadName: _rowText((json['threadName'] ?? json['name']) as String?),
      status: json['status'] != null
          ? CodexThreadStatus.fromJson(json['status'])
          : null,
      agentNickname: json['agentNickname'] as String?,
      agentRole: json['agentRole'] as String?,
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(
              json['summary'] as Map<String, dynamic>,
            ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      if (forkedFromId != null) 'forkedFromId': forkedFromId,
      'preview': preview,
      'cwd': cwd,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
      if (modelProvider != null) 'modelProvider': modelProvider,
      if (cliVersion != null) 'cliVersion': cliVersion,
      if (source != null) 'source': source,
      if (gitBranch != null) 'gitInfo': {'branch': gitBranch},
      if (threadName != null) 'threadName': threadName,
      if (status != null) 'status': status!.toJson(),
      if (agentNickname != null) 'agentNickname': agentNickname,
      if (agentRole != null) 'agentRole': agentRole,
    };
  }

  /// A row's title and preview are display text: a provider's colour codes are not shown.
  static String? _rowText(String? value) =>
      value == null ? null : stripAnsi(value);

  /// Display title: prefer threadName, then preview, then truncated ID.
  String get displayTitle => (threadName ?? '').trim().isNotEmpty
      ? threadName!
      : preview.trim().isNotEmpty
      ? preview
      : 'Thread ${id.substring(0, 8)}';

  DateTime get createdAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(createdAt * 1000);

  DateTime get updatedAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(updatedAt * 1000);
}

class CodexTranscriptToolCall {
  final String itemId;
  final String type;
  final String name;
  final String status;
  final Map<String, dynamic>? input;
  final String? output;
  final Map<String, dynamic>? metadata;

  const CodexTranscriptToolCall({
    required this.itemId,
    required this.type,
    required this.name,
    required this.status,
    this.input,
    this.output,
    this.metadata,
  });

  factory CodexTranscriptToolCall.fromJson(Map<String, dynamic> json) {
    return CodexTranscriptToolCall(
      itemId: json['itemId'] as String? ?? '',
      type: json['type'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? '',
      input: json['input'] is Map<String, dynamic>
          ? json['input'] as Map<String, dynamic>
          : null,
      output: json['output'] as String?,
      metadata: json['metadata'] is Map<String, dynamic>
          ? json['metadata'] as Map<String, dynamic>
          : null,
    );
  }
}

class CodexTranscriptDiff {
  final String file;
  final String diff;
  final int additions;
  final int deletions;
  final String? itemId;

  const CodexTranscriptDiff({
    required this.file,
    required this.diff,
    required this.additions,
    required this.deletions,
    this.itemId,
  });

  factory CodexTranscriptDiff.fromJson(Map<String, dynamic> json) {
    return CodexTranscriptDiff(
      file: json['file'] as String? ?? '',
      diff: json['diff'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      itemId: json['itemId'] as String?,
    );
  }
}

class CodexTranscriptMessage {
  final String id;
  final String role; // user|assistant|system
  final int createdAt; // unix seconds
  final String text;
  final String? thinking;
  final List<CodexTranscriptToolCall> toolCalls;
  final List<CodexTranscriptDiff> diffs;

  const CodexTranscriptMessage({
    required this.id,
    required this.role,
    required this.createdAt,
    required this.text,
    this.thinking,
    this.toolCalls = const [],
    this.diffs = const [],
  });

  factory CodexTranscriptMessage.fromJson(Map<String, dynamic> json) {
    final toolCalls =
        (json['toolCalls'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(CodexTranscriptToolCall.fromJson)
            .toList() ??
        const <CodexTranscriptToolCall>[];
    final diffs =
        (json['diffs'] as List<dynamic>?)
            ?.whereType<Map<String, dynamic>>()
            .map(CodexTranscriptDiff.fromJson)
            .toList() ??
        const <CodexTranscriptDiff>[];
    return CodexTranscriptMessage(
      id: json['id'] as String? ?? '',
      role: json['role'] as String? ?? 'assistant',
      createdAt: json['createdAt'] as int? ?? 0,
      text: json['text'] as String? ?? '',
      thinking: json['thinking'] as String?,
      toolCalls: toolCalls,
      diffs: diffs,
    );
  }
}

class CodexTokenUsageBreakdown {
  const CodexTokenUsageBreakdown({
    required this.totalTokens,
    required this.inputTokens,
    required this.cachedInputTokens,
    required this.outputTokens,
    required this.reasoningOutputTokens,
    this.cacheWriteTokens = 0,
  });

  final int totalTokens;
  final int inputTokens;
  final int cachedInputTokens;
  final int outputTokens;
  final int reasoningOutputTokens;
  final int cacheWriteTokens;

  factory CodexTokenUsageBreakdown.fromJson(Map<String, dynamic> json) {
    return CodexTokenUsageBreakdown(
      totalTokens: json['totalTokens'] as int? ?? 0,
      inputTokens: json['inputTokens'] as int? ?? 0,
      cachedInputTokens: json['cachedInputTokens'] as int? ?? 0,
      outputTokens: json['outputTokens'] as int? ?? 0,
      reasoningOutputTokens: json['reasoningOutputTokens'] as int? ?? 0,
      cacheWriteTokens:
          json['cacheWriteTokens'] as int? ??
          json['cacheCreationInputTokens'] as int? ??
          0,
    );
  }
}

class CodexThreadTokenUsage {
  const CodexThreadTokenUsage({
    required this.total,
    required this.last,
    this.modelContextWindow,
  });

  final CodexTokenUsageBreakdown total;
  final CodexTokenUsageBreakdown last;
  final int? modelContextWindow;

  factory CodexThreadTokenUsage.fromJson(Map<String, dynamic> json) {
    return CodexThreadTokenUsage(
      total: CodexTokenUsageBreakdown.fromJson(
        json['total'] as Map<String, dynamic>? ?? const {},
      ),
      last: CodexTokenUsageBreakdown.fromJson(
        json['last'] as Map<String, dynamic>? ?? const {},
      ),
      modelContextWindow: json['modelContextWindow'] as int?,
    );
  }
}

// ============================================================================
// CODEX SDK v0.87.0+ NEW TYPES
// ============================================================================

/// Personality setting for Codex sessions.
///
/// Controls the agent's communication style. Matches the SDK `Personality` type:
///   • `none`       – no personality overlay
///   • `friendly`   – warm, conversational tone
///   • `pragmatic`  – direct, efficient (SDK default since mid-2026)
enum CodexPersonality {
  none,
  friendly,
  pragmatic;

  String get wireValue => name;

  String get displayName {
    switch (this) {
      case CodexPersonality.none:
        return 'None';
      case CodexPersonality.friendly:
        return 'Friendly';
      case CodexPersonality.pragmatic:
        return 'Pragmatic';
    }
  }

  String get description {
    switch (this) {
      case CodexPersonality.none:
        return 'No personality overlay';
      case CodexPersonality.friendly:
        return 'Warm, conversational';
      case CodexPersonality.pragmatic:
        return 'Direct, efficient';
    }
  }

  factory CodexPersonality.fromString(String? v) {
    switch ((v ?? '').trim().toLowerCase()) {
      case 'none':
        return CodexPersonality.none;
      case 'friendly':
        return CodexPersonality.friendly;
      case 'pragmatic':
      default:
        return CodexPersonality.pragmatic;
    }
  }
}

enum CodexServiceTier {
  fast,
  flex;

  String get wireValue {
    switch (this) {
      case CodexServiceTier.fast:
        return 'fast';
      case CodexServiceTier.flex:
        return 'flex';
    }
  }

  String get displayName {
    switch (this) {
      case CodexServiceTier.fast:
        return 'Fast';
      case CodexServiceTier.flex:
        return 'Flex';
    }
  }

  static CodexServiceTier fromWireValue(String value) {
    switch (value) {
      case 'flex':
        return CodexServiceTier.flex;
      default:
        return CodexServiceTier.fast;
    }
  }
}

/// WebSearchMode replaces webSearchEnabled boolean (SDK v0.87.0+)
enum CodexWebSearchMode {
  disabled,
  cached,
  live;

  String get wireValue => name;

  factory CodexWebSearchMode.fromString(String? v) {
    switch (v) {
      case 'cached':
        return CodexWebSearchMode.cached;
      case 'live':
        return CodexWebSearchMode.live;
      default:
        return CodexWebSearchMode.disabled;
    }
  }
}

/// Collaboration mode for Codex sessions.
///
/// The Codex SDK (as of mid-2026) supports exactly two modes:
///   • `plan`    – agent proposes a plan before executing
///   • `default` – normal coding mode (balanced between discussion and action)
///
/// Legacy modes (code, pair_programming, execute, custom) are no longer valid
/// in the protocol and are mapped to `default` for backward compatibility.
enum CodexCollaborationMode {
  /// Agent proposes a plan before executing — restricted file edits, more discussion
  plan,

  /// Normal coding mode — balanced between discussion and action (SDK default)
  defaultMode;

  /// Wire value sent to Codex app-server (matches `ModeKind` in SDK schema)
  String get wireValue {
    switch (this) {
      case CodexCollaborationMode.plan:
        return 'plan';
      case CodexCollaborationMode.defaultMode:
        return 'default';
    }
  }

  String get displayName {
    switch (this) {
      case CodexCollaborationMode.plan:
        return 'Plan';
      case CodexCollaborationMode.defaultMode:
        return 'Default';
    }
  }

  String get description {
    switch (this) {
      case CodexCollaborationMode.plan:
        return 'Propose plan before executing';
      case CodexCollaborationMode.defaultMode:
        return 'Normal coding mode';
    }
  }

  /// Parse from wire/storage string. Legacy values map to [defaultMode].
  factory CodexCollaborationMode.fromString(String? v) {
    final raw = (v ?? '').trim();
    if (raw.isEmpty) return CodexCollaborationMode.defaultMode;

    final key = raw.replaceAll(RegExp(r'[-_]'), '').toLowerCase();
    switch (key) {
      case 'plan':
        return CodexCollaborationMode.plan;
      // Legacy modes → default
      case 'code':
      case 'pairprogramming':
      case 'pair':
      case 'pp':
      case 'execute':
      case 'exec':
      case 'custom':
      case 'default':
      case 'defaultmode':
      default:
        return CodexCollaborationMode.defaultMode;
    }
  }
}
