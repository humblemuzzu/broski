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
}

enum CodexReasoningEffort {
  minimal,
  low,
  medium,
  high,
  xhigh;

  String get wireValue {
    switch (this) {
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
    this.webSearchEnabled = false,
    this.skillsEnabled = false,
  });

  final CodexApprovalPolicy approvalPolicy;
  final CodexSandboxMode sandboxMode;
  final bool networkAccessEnabled;
  final CodexReasoningEffort reasoningEffort;
  final CodexReasoningSummary reasoningSummary;
  final bool webSearchEnabled;
  final bool skillsEnabled;

  CodexSettings copyWith({
    CodexApprovalPolicy? approvalPolicy,
    CodexSandboxMode? sandboxMode,
    bool? networkAccessEnabled,
    CodexReasoningEffort? reasoningEffort,
    CodexReasoningSummary? reasoningSummary,
    bool? webSearchEnabled,
    bool? skillsEnabled,
  }) {
    return CodexSettings(
      approvalPolicy: approvalPolicy ?? this.approvalPolicy,
      sandboxMode: sandboxMode ?? this.sandboxMode,
      networkAccessEnabled: networkAccessEnabled ?? this.networkAccessEnabled,
      reasoningEffort: reasoningEffort ?? this.reasoningEffort,
      reasoningSummary: reasoningSummary ?? this.reasoningSummary,
      webSearchEnabled: webSearchEnabled ?? this.webSearchEnabled,
      skillsEnabled: skillsEnabled ?? this.skillsEnabled,
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
      webSearchEnabled: json['webSearchEnabled'] == true,
      skillsEnabled: json['skillsEnabled'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'approvalPolicy': approvalPolicy.wireValue,
      'sandboxMode': sandboxMode.policyType,
      'networkAccessEnabled': networkAccessEnabled,
      'reasoningEffort': reasoningEffort.wireValue,
      'reasoningSummary': reasoningSummary.wireValue,
      'webSearchEnabled': webSearchEnabled,
      'skillsEnabled': skillsEnabled,
    };
  }
}

class CodexThread {
  final String id;
  final String preview;
  final String cwd;
  final int createdAt; // unix seconds
  final String? modelProvider;
  final String? cliVersion;
  final String? source;
  final String? gitBranch;

  const CodexThread({
    required this.id,
    required this.preview,
    required this.cwd,
    required this.createdAt,
    this.modelProvider,
    this.cliVersion,
    this.source,
    this.gitBranch,
  });

  factory CodexThread.fromJson(Map<String, dynamic> json) {
    final gitInfo = json['gitInfo'] as Map<String, dynamic>?;
    return CodexThread(
      id: json['id'] as String? ?? '',
      preview: json['preview'] as String? ?? '',
      cwd: json['cwd'] as String? ?? '',
      createdAt: json['createdAt'] as int? ?? 0,
      modelProvider: json['modelProvider'] as String?,
      cliVersion: json['cliVersion'] as String?,
      source: json['source'] as String?,
      gitBranch: gitInfo?['branch'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'preview': preview,
      'cwd': cwd,
      'createdAt': createdAt,
      if (modelProvider != null) 'modelProvider': modelProvider,
      if (cliVersion != null) 'cliVersion': cliVersion,
      if (source != null) 'source': source,
      if (gitBranch != null) 'gitInfo': {'branch': gitBranch},
    };
  }

  String get displayTitle =>
      preview.trim().isNotEmpty ? preview : 'Thread ${id.substring(0, 8)}';

  DateTime get createdAtDateTime =>
      DateTime.fromMillisecondsSinceEpoch(createdAt * 1000);
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
  });

  final int totalTokens;
  final int inputTokens;
  final int cachedInputTokens;
  final int outputTokens;
  final int reasoningOutputTokens;

  factory CodexTokenUsageBreakdown.fromJson(Map<String, dynamic> json) {
    return CodexTokenUsageBreakdown(
      totalTokens: json['totalTokens'] as int? ?? 0,
      inputTokens: json['inputTokens'] as int? ?? 0,
      cachedInputTokens: json['cachedInputTokens'] as int? ?? 0,
      outputTokens: json['outputTokens'] as int? ?? 0,
      reasoningOutputTokens: json['reasoningOutputTokens'] as int? ?? 0,
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

sealed class CodexStreamMessage {
  const CodexStreamMessage();

  factory CodexStreamMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String? ?? 'unknown';
    switch (type) {
      case 'notification':
        return CodexNotificationMessage.fromJson(json);
      case 'request':
        return CodexRequestMessage.fromJson(json);
      case 'error':
        return CodexErrorMessage.fromJson(json);
      default:
        return CodexUnknownMessage(type, json);
    }
  }
}

class CodexNotificationMessage extends CodexStreamMessage {
  final String method;
  final Map<String, dynamic> params;

  const CodexNotificationMessage({required this.method, required this.params});

  factory CodexNotificationMessage.fromJson(Map<String, dynamic> json) {
    return CodexNotificationMessage(
      method: json['method'] as String? ?? '',
      params: json['params'] is Map<String, dynamic>
          ? json['params'] as Map<String, dynamic>
          : const <String, dynamic>{},
    );
  }
}

class CodexRequestMessage extends CodexStreamMessage {
  final String requestId;
  final String method;
  final Map<String, dynamic> params;

  const CodexRequestMessage({
    required this.requestId,
    required this.method,
    required this.params,
  });

  factory CodexRequestMessage.fromJson(Map<String, dynamic> json) {
    return CodexRequestMessage(
      requestId: json['requestId'] as String? ?? '',
      method: json['method'] as String? ?? '',
      params: json['params'] is Map<String, dynamic>
          ? json['params'] as Map<String, dynamic>
          : const <String, dynamic>{},
    );
  }
}

class CodexErrorMessage extends CodexStreamMessage {
  final String message;
  final String? code;

  const CodexErrorMessage({required this.message, this.code});

  factory CodexErrorMessage.fromJson(Map<String, dynamic> json) {
    return CodexErrorMessage(
      message: json['message'] as String? ?? '',
      code: json['code'] as String?,
    );
  }
}

class CodexUnknownMessage extends CodexStreamMessage {
  final String type;
  final Map<String, dynamic> raw;

  const CodexUnknownMessage(this.type, this.raw);
}
