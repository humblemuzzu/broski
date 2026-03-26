import 'package:broski/utils/format_utils.dart';
import 'cc_model.dart';
import 'cc_permission.dart';

sealed class ClaudeCodeStreamMessage {
  /// When non-null, this message originated from inside a subagent's execution.
  /// Maps to `parent_tool_use_id` from the Claude Code SDK.
  final String? parentToolUseId;

  const ClaudeCodeStreamMessage({this.parentToolUseId});

  factory ClaudeCodeStreamMessage.fromJson(Map<String, dynamic> json) {
    final type = json['type'] as String?;
    switch (type) {
      case 'session-created':
        return CCSessionCreated.fromJson(json);
      case 'session-init':
        return CCSessionInit.fromJson(json);
      case 'compact-boundary':
        return CCCompactBoundary.fromJson(json);
      case 'permission-request':
        return CCPermissionRequest.fromJson(json);
      case 'checkpoint-created':
        return CCCheckpointCreated.fromJson(json);
      case 'assistant-message':
        return CCAssistantMessage.fromJson(json);
      case 'assistant-message-delta':
        return CCAssistantMessageDelta.fromJson(json);
      case 'thinking-delta':
        return CCThinkingDelta.fromJson(json);
      case 'tool-call':
        return CCToolCall.fromJson(json);
      case 'tool-result':
        return CCToolResult.fromJson(json);
      case 'subagent-invocation':
        return CCSubagentInvocation.fromJson(json);
      case 'token-usage':
        return CCTokenUsage.fromJson(json);
      case 'error':
        return CCError.fromJson(json);
      case 'task-started':
        return CCTaskStarted.fromJson(json);
      case 'task-progress':
        return CCTaskProgress.fromJson(json);
      case 'task-notification':
        return CCTaskNotification.fromJson(json);
      case 'tool-use-summary':
        return CCToolUseSummary.fromJson(json);
      case 'files-persisted':
        return CCFilesPersisted.fromJson(json);
      case 'status-update':
        return CCStatusUpdate.fromJson(json);
      case 'hook-started':
        return CCHookStarted.fromJson(json);
      case 'hook-progress':
        return CCHookProgress.fromJson(json);
      case 'hook-response':
        return CCHookResponse.fromJson(json);
      case 'auth-status':
        return CCAuthStatus.fromJson(json);
      case 'rate-limit-info':
        return CCRateLimitInfo.fromJson(json);
      case 'prompt-suggestion':
        return CCPromptSuggestion.fromJson(json);
      case 'assistant-error':
        return CCAssistantError.fromJson(json);
      case 'result-complete':
        return CCResultComplete.fromJson(json);
      case 'structured-output':
        return CCStructuredOutput.fromJson(json);
      case 'local-command-output':
        return CCLocalCommandOutput.fromJson(json);
      case 'elicitation-request':
        return CCElicitationRequest.fromJson(json);
      case 'elicitation-complete':
        return CCElicitationComplete.fromJson(json);
      default:
        return CCUnknown(type ?? 'unknown', json);
    }
  }
}

class CCSessionCreated extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String agent;
  final String? model;

  const CCSessionCreated({
    required this.sessionId,
    required this.agent,
    this.model,
    super.parentToolUseId,
  });

  factory CCSessionCreated.fromJson(Map<String, dynamic> json) {
    return CCSessionCreated(
      sessionId: json['sessionId'] as String? ?? '',
      agent: json['agent'] as String? ?? 'claude-code',
      model: json['model'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCSessionInit extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String model;
  final ClaudeCodePermissionMode permissionMode;
  final List<String> tools;
  final List<String> slashCommands;
  final List<String> skills;
  final List<Map<String, dynamic>> mcpServers;
  final List<Map<String, dynamic>> plugins;
  final List<ClaudeCodeSupportedModel> supportedModels;
  final ClaudeCodeAccountInfo? accountInfo;
  final String? apiKeySource;
  final String? claudeCodeVersion;

  /// Active beta features (SDK 0.2.42+).
  final List<String> betas;

  /// Output style (e.g. 'concise', 'verbose').

  /// Available output styles (SDK: available_output_styles).
  final List<String> availableOutputStyles;

  /// Working directory from SDK system init.
  final String? cwd;
  final String? outputStyle;

  /// Fast mode state for Opus 4.6: off, cooldown, on.
  final String? fastModeState;

  /// Agent definitions (subagents) available in this session (SDK 0.2.42+).
  final List<Map<String, dynamic>> agents;

  const CCSessionInit({
    required this.sessionId,
    required this.model,
    required this.permissionMode,
    required this.tools,
    required this.slashCommands,
    required this.skills,
    required this.mcpServers,
    required this.plugins,
    required this.supportedModels,
    this.accountInfo,
    this.apiKeySource,
    this.claudeCodeVersion,
    this.betas = const [],
    this.outputStyle,
    this.availableOutputStyles = const [],
    this.cwd,
    this.fastModeState,
    this.agents = const [],
    super.parentToolUseId,
  });

  factory CCSessionInit.fromJson(Map<String, dynamic> json) {
    return CCSessionInit(
      sessionId: json['sessionId'] as String? ?? '',
      model: json['model'] as String? ?? '',
      permissionMode: ClaudeCodePermissionMode.fromWireValue(
        json['permissionMode'] as String? ?? 'default',
      ),
      tools:
          (json['tools'] as List<dynamic>?)?.map((e) => '$e').toList() ??
          const [],
      slashCommands:
          (json['slashCommands'] as List<dynamic>?)
              ?.map((e) => '$e')
              .toList() ??
          const [],
      skills:
          (json['skills'] as List<dynamic>?)?.map((e) => '$e').toList() ??
          const [],
      mcpServers:
          (json['mcpServers'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
      plugins:
          (json['plugins'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
      supportedModels:
          (json['supportedModels'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map((item) => ClaudeCodeSupportedModel.fromJson(item))
              .toList() ??
          const [],
      accountInfo: json['accountInfo'] is Map<String, dynamic>
          ? ClaudeCodeAccountInfo.fromJson(
              json['accountInfo'] as Map<String, dynamic>,
            )
          : json['accountInfo'] is Map
          ? ClaudeCodeAccountInfo.fromJson(
              (json['accountInfo'] as Map).cast<String, dynamic>(),
            )
          : null,
      apiKeySource: json['apiKeySource'] as String?,
      claudeCodeVersion: json['claudeCodeVersion'] as String?,
      betas: (json['betas'] as List<dynamic>?)?.cast<String>() ?? const [],
      outputStyle: json['outputStyle'] as String?,
      availableOutputStyles: (json['availableOutputStyles'] as List<dynamic>?)?.cast<String>() ?? const [],
      cwd: json['cwd'] as String?,
      fastModeState: json['fastModeState'] as String?,
      agents:
          (json['agents'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCPermissionRequest extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String toolUseId;
  final String tool;
  final Map<String, dynamic> input;
  final String? decisionReason;
  final String? blockedPath;
  final bool hasSuggestions;
  final String? description;
  final String? agentId;

  const CCPermissionRequest({
    required this.sessionId,
    required this.toolUseId,
    required this.tool,
    required this.input,
    this.decisionReason,
    this.blockedPath,
    required this.hasSuggestions,
    this.description,
    this.agentId,
    super.parentToolUseId,
  });

  factory CCPermissionRequest.fromJson(Map<String, dynamic> json) {
    return CCPermissionRequest(
      sessionId: json['sessionId'] as String? ?? '',
      toolUseId: json['toolUseId'] as String? ?? '',
      tool: json['tool'] as String? ?? '',
      input: json['input'] is Map<String, dynamic>
          ? json['input'] as Map<String, dynamic>
          : const <String, dynamic>{},
      decisionReason: json['decisionReason'] as String?,
      blockedPath: json['blockedPath'] as String?,
      hasSuggestions: json['hasSuggestions'] as bool? ?? false,
      description: json['description'] as String?,
      agentId: json['agentId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

/// Checkpoint created event for file checkpointing/undo support.
/// Each user message turn creates a checkpoint that can be used to rewind file changes.
class CCCheckpointCreated extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String checkpointUuid;
  final int timestamp;

  const CCCheckpointCreated({
    required this.sessionId,
    required this.checkpointUuid,
    required this.timestamp,
    super.parentToolUseId,
  });

  factory CCCheckpointCreated.fromJson(Map<String, dynamic> json) {
    return CCCheckpointCreated(
      sessionId: json['sessionId'] as String? ?? '',
      checkpointUuid: json['checkpointUuid'] as String? ?? '',
      timestamp: json['timestamp'] as int? ?? 0,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  DateTime get timestampDateTime =>
      DateTime.fromMillisecondsSinceEpoch(timestamp);
}

class CCAssistantMessage extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessage({
    required this.content,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCAssistantMessage.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessage(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCAssistantMessageDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? messageId;

  const CCAssistantMessageDelta({
    required this.content,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCAssistantMessageDelta.fromJson(Map<String, dynamic> json) {
    return CCAssistantMessageDelta(
      content: json['content'] as String? ?? '',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCThinkingDelta extends ClaudeCodeStreamMessage {
  final String content;
  final String? partId;
  final String? messageId;

  const CCThinkingDelta({
    required this.content,
    this.partId,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCThinkingDelta.fromJson(Map<String, dynamic> json) {
    return CCThinkingDelta(
      content: json['content'] as String? ?? '',
      partId: json['partId'] as String?,
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCToolCall extends ClaudeCodeStreamMessage {
  final String tool;
  final dynamic input;
  final String? toolUseId;
  final String status;
  final String? messageId;

  const CCToolCall({
    required this.tool,
    this.input,
    this.toolUseId,
    required this.status,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCToolCall.fromJson(Map<String, dynamic> json) {
    return CCToolCall(
      tool: json['tool'] as String? ?? '',
      input: json['input'],
      toolUseId: json['toolUseId'] as String?,
      status: json['status'] as String? ?? 'running',
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCToolResult extends ClaudeCodeStreamMessage {
  final String? toolUseId;
  final dynamic result;
  final dynamic toolUseResult;
  final String? messageId;

  const CCToolResult({
    this.toolUseId,
    this.result,
    this.toolUseResult,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCToolResult.fromJson(Map<String, dynamic> json) {
    return CCToolResult(
      toolUseId: json['toolUseId'] as String?,
      result: json['result'],
      toolUseResult: json['toolUseResult'],
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

/// Subagent invocation event - emitted when Claude invokes a subagent via Task tool.
/// This provides UI feedback about which subagent is being used.
class CCSubagentInvocation extends ClaudeCodeStreamMessage {
  /// The name of the subagent being invoked (from subagent_type in Task input)
  final String subagentName;

  /// Tool use ID for correlation with tool-call events
  final String? toolUseId;

  /// The prompt/task given to the subagent
  final String? prompt;

  /// Description of what the subagent is doing
  final String? description;

  /// Identifier tying this invocation to an assistant turn/message.
  final String? messageId;

  const CCSubagentInvocation({
    required this.subagentName,
    this.toolUseId,
    this.prompt,
    this.description,
    this.messageId,
    super.parentToolUseId,
  });

  factory CCSubagentInvocation.fromJson(Map<String, dynamic> json) {
    return CCSubagentInvocation(
      subagentName: json['subagentName'] as String? ?? 'unknown',
      toolUseId: json['toolUseId'] as String?,
      prompt: json['prompt'] as String?,
      description: json['description'] as String?,
      messageId: json['messageId'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCCompactBoundary extends ClaudeCodeStreamMessage {
  final String trigger;
  final int preTokens;

  const CCCompactBoundary({
    required this.trigger,
    required this.preTokens,
    super.parentToolUseId,
  });

  factory CCCompactBoundary.fromJson(Map<String, dynamic> json) {
    return CCCompactBoundary(
      trigger: json['trigger'] as String? ?? 'auto',
      preTokens: (json['preTokens'] as num?)?.toInt() ?? 0,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCModelUsage {
  final int inputTokens;
  final int outputTokens;
  final int cacheReadInputTokens;
  final int cacheCreationInputTokens;
  final int webSearchRequests;
  final double costUsd;
  final int contextWindow;
  final int? maxOutputTokens;

  const CCModelUsage({
    required this.inputTokens,
    required this.outputTokens,
    required this.cacheReadInputTokens,
    required this.cacheCreationInputTokens,
    required this.webSearchRequests,
    required this.costUsd,
    required this.contextWindow,
    this.maxOutputTokens,
  });

  factory CCModelUsage.fromJson(Map<String, dynamic> json) {
    return CCModelUsage(
      inputTokens: (json['inputTokens'] as num?)?.toInt() ?? 0,
      outputTokens: (json['outputTokens'] as num?)?.toInt() ?? 0,
      cacheReadInputTokens:
          (json['cacheReadInputTokens'] as num?)?.toInt() ?? 0,
      cacheCreationInputTokens:
          (json['cacheCreationInputTokens'] as num?)?.toInt() ?? 0,
      webSearchRequests: (json['webSearchRequests'] as num?)?.toInt() ?? 0,
      costUsd: (json['costUSD'] as num?)?.toDouble() ?? 0.0,
      contextWindow: (json['contextWindow'] as num?)?.toInt() ?? 0,
      maxOutputTokens: (json['maxOutputTokens'] as num?)?.toInt(),
    );
  }
}

class CCTokenUsage extends ClaudeCodeStreamMessage {
  final int? inputTokens;
  final int? outputTokens;
  final int? cacheReadTokens;
  final int? cacheCreationTokens;
  final double? totalCostUsd;
  final Map<String, CCModelUsage>? modelUsage;
  final String? messageId;
  // Context window tracking (SDK v2.1.6+)
  final int? contextWindow;
  // Per-turn context tokens from usage.iterations[-1] (actual window occupancy).
  // The cumulative inputTokens/cacheReadTokens grow across all turns.
  // This field is the LAST iteration's input+cacheRead+cacheWrite = what's in the window NOW.
  final int? lastIterContextTokens;

  const CCTokenUsage({
    this.inputTokens,
    this.outputTokens,
    this.cacheReadTokens,
    this.cacheCreationTokens,
    this.totalCostUsd,
    this.modelUsage,
    this.messageId,
    this.contextWindow,
    this.lastIterContextTokens,
    super.parentToolUseId,
  });

  factory CCTokenUsage.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'] as Map<String, dynamic>? ?? json;
    return CCTokenUsage(
      inputTokens: usage['inputTokens'] as int?,
      outputTokens: usage['outputTokens'] as int?,
      cacheReadTokens: usage['cacheReadTokens'] as int?,
      cacheCreationTokens: usage['cacheCreationTokens'] as int?,
      totalCostUsd: (json['totalCostUsd'] as num?)?.toDouble(),
      modelUsage: json['modelUsage'] is Map<String, dynamic>
          ? (json['modelUsage'] as Map<String, dynamic>).map(
              (key, value) => MapEntry(
                key,
                value is Map<String, dynamic>
                    ? CCModelUsage.fromJson(value)
                    : value is Map
                    ? CCModelUsage.fromJson(value.cast<String, dynamic>())
                    : const CCModelUsage(
                        inputTokens: 0,
                        outputTokens: 0,
                        cacheReadInputTokens: 0,
                        cacheCreationInputTokens: 0,
                        webSearchRequests: 0,
                        costUsd: 0.0,
                        contextWindow: 0,
                      ),
              ),
            )
          : null,
      messageId: json['messageId'] as String?,
      contextWindow:
          usage['contextWindow'] as int? ?? json['contextWindow'] as int?,
      lastIterContextTokens: usage['lastIterContextTokens'] as int?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  /// Fresh tokens consumed (input + output only, not cache reads)
  int get totalTokens => (inputTokens ?? 0) + (outputTokens ?? 0);

  /// Effective context window (defaults to Claude 3.5 Sonnet's 200k)
  int get effectiveContextWindow {
    if (contextWindow != null && contextWindow! > 0) return contextWindow!;
    final firstFromModels = modelUsage?.values
        .map((entry) => entry.contextWindow)
        .firstWhere((entry) => entry > 0, orElse: () => 0);
    if (firstFromModels != null && firstFromModels > 0) return firstFromModels;
    return kDefaultContextWindow;
  }

  /// Context window used percentage (0-100)
  /// Prefers per-turn lastIterContextTokens (actual window occupancy) over
  /// cumulative inputTokens. Falls back to inputTokens when iterations unavailable.
  double get usedPercentage {
    final tokens = lastIterContextTokens ?? inputTokens;
    if (tokens == null || tokens == 0) return 0.0;
    return ((tokens / effectiveContextWindow) * 100).clamp(0.0, 100.0);
  }

  /// Context window remaining percentage (0-100)
  double get remainingPercentage => 100.0 - usedPercentage;
}

class CCError extends ClaudeCodeStreamMessage {
  final String message;
  final String? code;

  const CCError({required this.message, this.code, super.parentToolUseId});

  factory CCError.fromJson(Map<String, dynamic> json) {
    return CCError(
      message: json['message'] as String? ?? 'Unknown error',
      code: json['code'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

// ── SDK 0.2.52: Task lifecycle events (agent teams) ─────────────────────
class CCTaskStarted extends ClaudeCodeStreamMessage {
  final String taskId;
  final String? toolUseId;
  final String description;
  final String? taskType;

  const CCTaskStarted({
    required this.taskId,
    this.toolUseId,
    required this.description,
    this.taskType,
    super.parentToolUseId,
  });

  factory CCTaskStarted.fromJson(Map<String, dynamic> json) {
    return CCTaskStarted(
      taskId: json['taskId'] as String? ?? '',
      toolUseId: json['toolUseId'] as String?,
      description: json['description'] as String? ?? '',
      taskType: json['taskType'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCTaskProgress extends ClaudeCodeStreamMessage {
  final String taskId;
  final String? toolUseId;
  final String description;
  final int? totalTokens;
  final int? toolUses;
  final int? durationMs;
  final String? lastToolName;
  final String? summary;

  const CCTaskProgress({
    required this.taskId,
    this.toolUseId,
    required this.description,
    this.totalTokens,
    this.toolUses,
    this.durationMs,
    this.lastToolName,
    this.summary,
    super.parentToolUseId,
  });

  factory CCTaskProgress.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'];
    final usageMap = usage is Map<String, dynamic>
        ? usage
        : usage is Map
        ? usage.cast<String, dynamic>()
        : null;

    return CCTaskProgress(
      taskId: json['taskId'] as String? ?? '',
      toolUseId: json['toolUseId'] as String?,
      description: json['description'] as String? ?? '',
      totalTokens: (usageMap?['totalTokens'] as num?)?.toInt(),
      toolUses: (usageMap?['toolUses'] as num?)?.toInt(),
      durationMs: (usageMap?['durationMs'] as num?)?.toInt(),
      lastToolName: json['lastToolName'] as String?,
      summary: json['summary'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCTaskNotification extends ClaudeCodeStreamMessage {
  final String taskId;
  final String? toolUseId;
  final String status; // completed | failed | stopped
  final String summary;
  final String? outputFile;
  final int? totalTokens;
  final int? toolUses;
  final int? durationMs;

  const CCTaskNotification({
    required this.taskId,
    this.toolUseId,
    required this.status,
    required this.summary,
    this.outputFile,
    this.totalTokens,
    this.toolUses,
    this.durationMs,
    super.parentToolUseId,
  });

  factory CCTaskNotification.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'];
    final usageMap = usage is Map<String, dynamic>
        ? usage
        : usage is Map
        ? usage.cast<String, dynamic>()
        : null;

    return CCTaskNotification(
      taskId: json['taskId'] as String? ?? '',
      toolUseId: json['toolUseId'] as String?,
      status: json['status'] as String? ?? 'completed',
      summary: json['summary'] as String? ?? '',
      outputFile: json['outputFile'] as String?,
      totalTokens: (usageMap?['totalTokens'] as num?)?.toInt(),
      toolUses: (usageMap?['toolUses'] as num?)?.toInt(),
      durationMs: (usageMap?['durationMs'] as num?)?.toInt(),
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get isRunning =>
      status != 'completed' && status != 'failed' && status != 'stopped';
  bool get isCompleted => status == 'completed';
  bool get isFailed => status == 'failed';
}

// ── SDK 0.2.42: Tool use summary ────────────────────────────────────────
class CCToolUseSummary extends ClaudeCodeStreamMessage {
  final String summary;
  final List<String> precedingToolUseIds;

  const CCToolUseSummary({
    required this.summary,
    required this.precedingToolUseIds,
    super.parentToolUseId,
  });

  factory CCToolUseSummary.fromJson(Map<String, dynamic> json) {
    return CCToolUseSummary(
      summary: json['summary'] as String? ?? '',
      precedingToolUseIds:
          (json['precedingToolUseIds'] as List<dynamic>?)?.cast<String>() ??
          const [],
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

// ── SDK 0.2.42: Files persisted ─────────────────────────────────────────
class CCFilesPersisted extends ClaudeCodeStreamMessage {
  final List<Map<String, String>> files;
  final List<Map<String, String>> failed;

  const CCFilesPersisted({
    required this.files,
    required this.failed,
    super.parentToolUseId,
  });

  factory CCFilesPersisted.fromJson(Map<String, dynamic> json) {
    return CCFilesPersisted(
      files:
          (json['files'] as List<dynamic>?)
              ?.map(
                (f) => {
                  'filename': (f as Map)['filename']?.toString() ?? '',
                  'fileId': f['fileId']?.toString() ?? '',
                },
              )
              .toList() ??
          const [],
      failed:
          (json['failed'] as List<dynamic>?)
              ?.map(
                (f) => {
                  'filename': (f as Map)['filename']?.toString() ?? '',
                  'error': f['error']?.toString() ?? '',
                },
              )
              .toList() ??
          const [],
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

// ── SDK 0.2.42: Status update (compacting / permission mode) ────────────
class CCStatusUpdate extends ClaudeCodeStreamMessage {
  final String? status; // 'compacting' | null
  final String? permissionMode;

  const CCStatusUpdate({
    this.status,
    this.permissionMode,
    super.parentToolUseId,
  });

  factory CCStatusUpdate.fromJson(Map<String, dynamic> json) {
    return CCStatusUpdate(
      status: json['status'] as String?,
      permissionMode: json['permissionMode'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get isCompacting => status == 'compacting';
}

// ── SDK 0.2.42: Hook lifecycle events ───────────────────────────────────
class CCHookStarted extends ClaudeCodeStreamMessage {
  final String hookId;
  final String hookName;
  final String hookEvent;

  const CCHookStarted({
    required this.hookId,
    required this.hookName,
    required this.hookEvent,
    super.parentToolUseId,
  });

  factory CCHookStarted.fromJson(Map<String, dynamic> json) {
    return CCHookStarted(
      hookId: json['hookId'] as String? ?? '',
      hookName: json['hookName'] as String? ?? '',
      hookEvent: json['hookEvent'] as String? ?? '',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCHookProgress extends ClaudeCodeStreamMessage {
  final String hookId;
  final String hookName;
  final String hookEvent;
  final String output;

  const CCHookProgress({
    required this.hookId,
    required this.hookName,
    required this.hookEvent,
    required this.output,
    super.parentToolUseId,
  });

  factory CCHookProgress.fromJson(Map<String, dynamic> json) {
    return CCHookProgress(
      hookId: json['hookId'] as String? ?? '',
      hookName: json['hookName'] as String? ?? '',
      hookEvent: json['hookEvent'] as String? ?? '',
      output: json['output'] as String? ?? '',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCHookResponse extends ClaudeCodeStreamMessage {
  final String hookId;
  final String hookName;
  final String hookEvent;
  final String output;
  final String outcome; // success | error | cancelled
  final int? exitCode;

  const CCHookResponse({
    required this.hookId,
    required this.hookName,
    required this.hookEvent,
    required this.output,
    required this.outcome,
    this.exitCode,
    super.parentToolUseId,
  });

  factory CCHookResponse.fromJson(Map<String, dynamic> json) {
    return CCHookResponse(
      hookId: json['hookId'] as String? ?? '',
      hookName: json['hookName'] as String? ?? '',
      hookEvent: json['hookEvent'] as String? ?? '',
      output: json['output'] as String? ?? '',
      outcome: json['outcome'] as String? ?? 'success',
      exitCode: (json['exitCode'] as num?)?.toInt(),
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get isSuccess => outcome == 'success';
  bool get isError => outcome == 'error';
}

// ── SDK 0.2.42: Auth status ─────────────────────────────────────────────
class CCAuthStatus extends ClaudeCodeStreamMessage {
  final bool isAuthenticating;
  final List<String> output;
  final String? error;

  const CCAuthStatus({
    required this.isAuthenticating,
    required this.output,
    this.error,
    super.parentToolUseId,
  });

  factory CCAuthStatus.fromJson(Map<String, dynamic> json) {
    return CCAuthStatus(
      isAuthenticating: json['isAuthenticating'] as bool? ?? false,
      output: (json['output'] as List<dynamic>?)?.cast<String>() ?? const [],
      error: json['error'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCRateLimitInfo extends ClaudeCodeStreamMessage {
  final String? status;
  final int? resetsAt;
  final String? rateLimitType;
  final double? utilization;
  final String? overageStatus;
  final int? overageResetsAt;
  final String? overageDisabledReason;
  final bool? isUsingOverage;
  final double? surpassedThreshold;
  final Map<String, dynamic> data;

  const CCRateLimitInfo({
    this.status,
    this.resetsAt,
    this.rateLimitType,
    this.utilization,
    this.overageStatus,
    this.overageResetsAt,
    this.overageDisabledReason,
    this.isUsingOverage,
    this.surpassedThreshold,
    this.data = const {},
    super.parentToolUseId,
  });

  factory CCRateLimitInfo.fromJson(Map<String, dynamic> json) {
    final dataRaw = json['data'];
    final data = dataRaw is Map<String, dynamic>
        ? dataRaw
        : dataRaw is Map
        ? dataRaw.cast<String, dynamic>()
        : <String, dynamic>{};

    double? toDouble(dynamic value) {
      if (value == null) return null;
      if (value is num) return value.toDouble();
      if (value is String) return double.tryParse(value);
      return null;
    }

    return CCRateLimitInfo(
      status: data['status'] as String?,
      resetsAt: (data['resetsAt'] as num?)?.toInt(),
      rateLimitType: data['rateLimitType'] as String?,
      utilization: toDouble(data['utilization']),
      overageStatus: data['overageStatus'] as String?,
      overageResetsAt: (data['overageResetsAt'] as num?)?.toInt(),
      overageDisabledReason: data['overageDisabledReason'] as String?,
      isUsingOverage: data['isUsingOverage'] as bool?,
      surpassedThreshold: toDouble(data['surpassedThreshold']),
      data: data,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCPromptSuggestion extends ClaudeCodeStreamMessage {
  final String suggestion;

  const CCPromptSuggestion({required this.suggestion, super.parentToolUseId});

  factory CCPromptSuggestion.fromJson(Map<String, dynamic> json) {
    return CCPromptSuggestion(
      suggestion: json['suggestion'] as String? ?? '',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

// ── SDK 0.2.42: Assistant-level error classification ────────────────────
class CCAssistantError extends ClaudeCodeStreamMessage {
  /// Error type: authentication_failed | billing_error | rate_limit |
  /// invalid_request | server_error | unknown | max_output_tokens
  final String errorType;

  const CCAssistantError({required this.errorType, super.parentToolUseId});

  factory CCAssistantError.fromJson(Map<String, dynamic> json) {
    return CCAssistantError(
      errorType: json['errorType'] as String? ?? 'unknown',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get isAuthError => errorType == 'authentication_failed';
  bool get isBillingError => errorType == 'billing_error';
  bool get isRateLimit => errorType == 'rate_limit';
  bool get isMaxOutputTokens => errorType == 'max_output_tokens';
}

// ── SDK 0.2.42: Result complete with stop reason + subtype metadata ─────
class CCResultComplete extends ClaudeCodeStreamMessage {
  final String? stopReason;
  final int? numTurns;
  final int? durationMs;
  final int? durationApiMs;
  final String? subtype;
  final bool? isError;
  final List<String> errors;
  final List<CCPermissionDenial> permissionDenials;
  final String? fastModeState;

  const CCResultComplete({
    this.stopReason,
    this.numTurns,
    this.durationMs,
    this.durationApiMs,
    this.subtype,
    this.isError,
    this.errors = const [],
    this.permissionDenials = const [],
    this.fastModeState,
    super.parentToolUseId,
  });

  factory CCResultComplete.fromJson(Map<String, dynamic> json) {
    final denialsRaw = json['permissionDenials'] as List<dynamic>?;
    return CCResultComplete(
      stopReason: json['stopReason'] as String?,
      numTurns: (json['numTurns'] as num?)?.toInt(),
      durationMs: (json['durationMs'] as num?)?.toInt(),
      durationApiMs: (json['durationApiMs'] as num?)?.toInt(),
      subtype: json['subtype'] as String?,
      isError: json['isError'] as bool?,
      errors:
          (json['errors'] as List<dynamic>?)?.whereType<String>().toList() ??
          const [],
      permissionDenials:
          denialsRaw
              ?.whereType<Map<String, dynamic>>()
              .map(CCPermissionDenial.fromJson)
              .toList() ??
          const [],
      fastModeState: json['fastModeState'] as String?,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get hasErrorSignal =>
      isError == true || (subtype?.startsWith('error_') ?? false);
}

class CCPermissionDenial {
  final String toolName;
  final String toolUseId;
  final Map<String, dynamic>? toolInput;

  const CCPermissionDenial({
    required this.toolName,
    required this.toolUseId,
    this.toolInput,
  });

  factory CCPermissionDenial.fromJson(Map<String, dynamic> json) {
    final rawInput = json['toolInput'];
    return CCPermissionDenial(
      toolName: json['toolName'] as String? ?? '',
      toolUseId: json['toolUseId'] as String? ?? '',
      toolInput: rawInput is Map<String, dynamic>
          ? rawInput
          : rawInput is Map
          ? rawInput.cast<String, dynamic>()
          : null,
    );
  }
}

/// Structured output payload from SDK result messages.
/// Emitted only when outputFormat/json_schema is configured.
class CCStructuredOutput extends ClaudeCodeStreamMessage {
  final dynamic data;

  const CCStructuredOutput({required this.data, super.parentToolUseId});

  factory CCStructuredOutput.fromJson(Map<String, dynamic> json) {
    return CCStructuredOutput(
      data: json['data'],
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCLocalCommandOutput extends ClaudeCodeStreamMessage {
  final String content;

  const CCLocalCommandOutput({required this.content, super.parentToolUseId});

  factory CCLocalCommandOutput.fromJson(Map<String, dynamic> json) {
    return CCLocalCommandOutput(
      content: json['content'] as String? ?? '',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCElicitationRequest extends ClaudeCodeStreamMessage {
  final String sessionId;
  final String requestId;
  final String mcpServerName;
  final String message;
  final String? mode;
  final String? url;
  final String? elicitationId;
  final Map<String, dynamic>? requestedSchema;

  const CCElicitationRequest({
    required this.sessionId,
    required this.requestId,
    required this.mcpServerName,
    required this.message,
    this.mode,
    this.url,
    this.elicitationId,
    this.requestedSchema,
    super.parentToolUseId,
  });

  factory CCElicitationRequest.fromJson(Map<String, dynamic> json) {
    final requestedSchemaRaw = json['requestedSchema'];
    return CCElicitationRequest(
      sessionId: json['sessionId'] as String? ?? '',
      requestId: json['requestId'] as String? ?? '',
      mcpServerName: json['mcpServerName'] as String? ?? '',
      message: json['message'] as String? ?? '',
      mode: json['mode'] as String?,
      url: json['url'] as String?,
      elicitationId: json['elicitationId'] as String?,
      requestedSchema: requestedSchemaRaw is Map<String, dynamic>
          ? requestedSchemaRaw
          : requestedSchemaRaw is Map
          ? requestedSchemaRaw.cast<String, dynamic>()
          : null,
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }

  bool get isUrlMode => mode == 'url';
  bool get isFormMode => mode == 'form';
}

class CCElicitationComplete extends ClaudeCodeStreamMessage {
  final String mcpServerName;
  final String elicitationId;

  const CCElicitationComplete({
    required this.mcpServerName,
    required this.elicitationId,
    super.parentToolUseId,
  });

  factory CCElicitationComplete.fromJson(Map<String, dynamic> json) {
    return CCElicitationComplete(
      mcpServerName: json['mcpServerName'] as String? ?? '',
      elicitationId: json['elicitationId'] as String? ?? '',
      parentToolUseId: json['parentToolUseId'] as String?,
    );
  }
}

class CCUnknown extends ClaudeCodeStreamMessage {
  final String type;
  final Map<String, dynamic> data;

  const CCUnknown(this.type, this.data, {super.parentToolUseId});
}
