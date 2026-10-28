import 'package:broski/models/claude_code/cc_model.dart';
import 'package:broski/models/claude_code/cc_permission.dart';
import 'package:broski/utils/format_utils.dart';

class CCSessionInit {
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

  /// Available output styles (SDK: available_output_styles).
  final List<String> availableOutputStyles;

  /// Working directory from SDK system init.
  final String? cwd;

  /// Output style (e.g. 'concise', 'verbose').
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
      availableOutputStyles:
          (json['availableOutputStyles'] as List<dynamic>?)?.cast<String>() ??
          const [],
      cwd: json['cwd'] as String?,
      fastModeState: json['fastModeState'] as String?,
      agents:
          (json['agents'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .toList() ??
          const [],
    );
  }
}

/// Checkpoint created event for file checkpointing/undo support.
/// Each user message turn creates a checkpoint that can be used to rewind file changes.
class CCCheckpointCreated {
  final String sessionId;
  final String checkpointUuid;
  final int timestamp;

  const CCCheckpointCreated({
    required this.sessionId,
    required this.checkpointUuid,
    required this.timestamp,
  });

  factory CCCheckpointCreated.fromJson(Map<String, dynamic> json) {
    return CCCheckpointCreated(
      sessionId: json['sessionId'] as String? ?? '',
      checkpointUuid: json['checkpointUuid'] as String? ?? '',
      timestamp: json['timestamp'] as int? ?? 0,
    );
  }

  DateTime get timestampDateTime =>
      DateTime.fromMillisecondsSinceEpoch(timestamp);
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

class CCTokenUsage {
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
