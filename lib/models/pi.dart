import 'session.dart' show SessionSummaryStats;

class PiModelCost {
  final double input;
  final double output;
  final double cacheRead;
  final double cacheWrite;

  const PiModelCost({
    this.input = 0,
    this.output = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
  });

  factory PiModelCost.fromJson(Map<String, dynamic> json) {
    return PiModelCost(
      input: (json['input'] as num?)?.toDouble() ?? 0,
      output: (json['output'] as num?)?.toDouble() ?? 0,
      cacheRead: (json['cacheRead'] as num?)?.toDouble() ?? 0,
      cacheWrite: (json['cacheWrite'] as num?)?.toDouble() ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'input': input,
      'output': output,
      'cacheRead': cacheRead,
      'cacheWrite': cacheWrite,
    };
  }
}

class PiModel {
  final String id;
  final String name;
  final String provider;
  final String api;
  final int contextWindow;
  final int maxTokens;
  final bool reasoning;
  final List<String> input;
  final PiModelCost cost;

  const PiModel({
    required this.id,
    required this.name,
    required this.provider,
    required this.api,
    required this.contextWindow,
    required this.maxTokens,
    required this.reasoning,
    required this.input,
    required this.cost,
  });

  factory PiModel.fromJson(Map<String, dynamic> json) {
    final rawInput = json['input'] as List<dynamic>?;
    return PiModel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      provider: json['provider'] as String? ?? '',
      api: json['api'] as String? ?? '',
      contextWindow: json['contextWindow'] as int? ?? 0,
      maxTokens: json['maxTokens'] as int? ?? 0,
      reasoning: json['reasoning'] as bool? ?? false,
      input:
          rawInput?.map((entry) => entry.toString()).toList() ?? const ['text'],
      cost: PiModelCost.fromJson(
        json['cost'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'provider': provider,
      'api': api,
      'contextWindow': contextWindow,
      'maxTokens': maxTokens,
      'reasoning': reasoning,
      'input': input,
      'cost': cost.toJson(),
    };
  }

  bool get supportsImages => input.contains('image');

  String get modelRef => '$provider/$id';
}

enum PiThinkingLevel {
  off,
  minimal,
  low,
  medium,
  high,
  xhigh;

  String get wireValue => name;

  String get displayName {
    switch (this) {
      case PiThinkingLevel.off:
        return 'Off';
      case PiThinkingLevel.minimal:
        return 'Minimal';
      case PiThinkingLevel.low:
        return 'Low';
      case PiThinkingLevel.medium:
        return 'Medium';
      case PiThinkingLevel.high:
        return 'High';
      case PiThinkingLevel.xhigh:
        return 'Max';
    }
  }

  static PiThinkingLevel fromWireValue(String value) {
    switch (value) {
      case 'off':
        return PiThinkingLevel.off;
      case 'minimal':
        return PiThinkingLevel.minimal;
      case 'low':
        return PiThinkingLevel.low;
      case 'high':
        return PiThinkingLevel.high;
      case 'xhigh':
        return PiThinkingLevel.xhigh;
      default:
        return PiThinkingLevel.medium;
    }
  }
}

class PiState {
  final PiModel? model;
  final PiThinkingLevel thinkingLevel;
  final bool isStreaming;
  final bool isCompacting;
  final bool isRetrying;
  final String? sessionFile;
  final String sessionId;
  final String? sessionName;
  final String steeringMode;
  final String followUpMode;
  final bool autoCompactionEnabled;
  final bool autoRetryEnabled;
  final int messageCount;
  final int pendingMessageCount;

  const PiState({
    this.model,
    this.thinkingLevel = PiThinkingLevel.medium,
    this.isStreaming = false,
    this.isCompacting = false,
    this.isRetrying = false,
    this.sessionFile,
    this.sessionId = '',
    this.sessionName,
    this.steeringMode = 'all',
    this.followUpMode = 'all',
    this.autoCompactionEnabled = true,
    this.autoRetryEnabled = true,
    this.messageCount = 0,
    this.pendingMessageCount = 0,
  });

  factory PiState.fromJson(Map<String, dynamic> json) {
    final modelJson = json['model'];
    return PiState(
      model: modelJson is Map<String, dynamic>
          ? PiModel.fromJson(modelJson)
          : null,
      thinkingLevel: PiThinkingLevel.fromWireValue(
        json['thinkingLevel'] as String? ?? 'medium',
      ),
      isStreaming: json['isStreaming'] as bool? ?? false,
      isCompacting: json['isCompacting'] as bool? ?? false,
      isRetrying: json['isRetrying'] as bool? ?? false,
      sessionFile: json['sessionFile'] as String?,
      sessionId: json['sessionId'] as String? ?? '',
      sessionName: json['sessionName'] as String?,
      steeringMode: json['steeringMode'] as String? ?? 'all',
      followUpMode: json['followUpMode'] as String? ?? 'all',
      autoCompactionEnabled: json['autoCompactionEnabled'] as bool? ?? true,
      autoRetryEnabled: json['autoRetryEnabled'] as bool? ?? true,
      messageCount: json['messageCount'] as int? ?? 0,
      pendingMessageCount: json['pendingMessageCount'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (model != null) 'model': model!.toJson(),
      'thinkingLevel': thinkingLevel.wireValue,
      'isStreaming': isStreaming,
      'isCompacting': isCompacting,
      'isRetrying': isRetrying,
      if (sessionFile != null) 'sessionFile': sessionFile,
      'sessionId': sessionId,
      if (sessionName != null) 'sessionName': sessionName,
      'steeringMode': steeringMode,
      'followUpMode': followUpMode,
      'autoCompactionEnabled': autoCompactionEnabled,
      'autoRetryEnabled': autoRetryEnabled,
      'messageCount': messageCount,
      'pendingMessageCount': pendingMessageCount,
    };
  }
}

class PiSessionInfo {
  final String path;
  final String id;
  final String cwd;
  final String? name;
  final String? parentSessionPath;
  final DateTime created;
  final DateTime modified;
  final int messageCount;
  final String firstMessage;
  final SessionSummaryStats? summary;

  const PiSessionInfo({
    required this.path,
    required this.id,
    required this.cwd,
    this.name,
    this.parentSessionPath,
    required this.created,
    required this.modified,
    required this.messageCount,
    required this.firstMessage,
    this.summary,
  });

  factory PiSessionInfo.fromJson(Map<String, dynamic> json) {
    return PiSessionInfo(
      path: json['path'] as String? ?? '',
      id: json['id'] as String? ?? '',
      cwd: json['cwd'] as String? ?? '',
      name: json['name'] as String?,
      parentSessionPath: json['parentSessionPath'] as String?,
      created: DateTime.fromMillisecondsSinceEpoch(
        json['created'] as int? ?? 0,
      ),
      modified: DateTime.fromMillisecondsSinceEpoch(
        json['modified'] as int? ?? 0,
      ),
      messageCount: json['messageCount'] as int? ?? 0,
      firstMessage: json['firstMessage'] as String? ?? '',
      summary: json['summary'] == null
          ? null
          : SessionSummaryStats.fromJson(
              json['summary'] as Map<String, dynamic>,
            ),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'path': path,
      'id': id,
      'cwd': cwd,
      if (name != null) 'name': name,
      if (parentSessionPath != null) 'parentSessionPath': parentSessionPath,
      'created': created.millisecondsSinceEpoch,
      'modified': modified.millisecondsSinceEpoch,
      'messageCount': messageCount,
      'firstMessage': firstMessage,
    };
  }
}

class PiCommand {
  final String name;
  final String? description;
  final String source;
  final String? location;
  final String? path;

  const PiCommand({
    required this.name,
    this.description,
    required this.source,
    this.location,
    this.path,
  });

  factory PiCommand.fromJson(Map<String, dynamic> json) {
    return PiCommand(
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      source: json['source'] as String? ?? 'extension',
      location: json['location'] as String?,
      path: json['path'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      if (description != null) 'description': description,
      'source': source,
      if (location != null) 'location': location,
      if (path != null) 'path': path,
    };
  }

  String get slashForm => '/$name';
}

class PiForkMessage {
  final String entryId;
  final String text;

  const PiForkMessage({required this.entryId, required this.text});

  factory PiForkMessage.fromJson(Map<String, dynamic> json) {
    return PiForkMessage(
      entryId: json['entryId'] as String? ?? '',
      text: json['text'] as String? ?? '',
    );
  }
}

class PiTokenUsage {
  final int input;
  final int output;
  final int cacheRead;
  final int cacheWrite;
  final int total;

  const PiTokenUsage({
    this.input = 0,
    this.output = 0,
    this.cacheRead = 0,
    this.cacheWrite = 0,
    this.total = 0,
  });

  factory PiTokenUsage.fromJson(Map<String, dynamic> json) {
    return PiTokenUsage(
      input: json['input'] as int? ?? 0,
      output: json['output'] as int? ?? 0,
      cacheRead: json['cacheRead'] as int? ?? 0,
      cacheWrite: json['cacheWrite'] as int? ?? 0,
      total: json['total'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'input': input,
      'output': output,
      'cacheRead': cacheRead,
      'cacheWrite': cacheWrite,
      'total': total,
    };
  }
}

/// Context usage from Pi's estimateContextTokens — actual tokens in the window.
class PiContextUsage {
  final int? tokens;
  final int contextWindow;
  final double? percent;

  const PiContextUsage({
    this.tokens,
    this.contextWindow = 200000,
    this.percent,
  });

  factory PiContextUsage.fromJson(Map<String, dynamic> json) {
    return PiContextUsage(
      tokens: (json['tokens'] as num?)?.toInt(),
      contextWindow: json['contextWindow'] as int? ?? 200000,
      percent: (json['percent'] as num?)?.toDouble(),
    );
  }
}

class PiSessionStats {
  final String? sessionFile;
  final String sessionId;
  final int userMessages;
  final int assistantMessages;
  final int toolCalls;
  final int toolResults;
  final int totalMessages;
  final PiTokenUsage tokens;
  final double cost;
  final PiContextUsage? contextUsage;

  const PiSessionStats({
    this.sessionFile,
    this.sessionId = '',
    this.userMessages = 0,
    this.assistantMessages = 0,
    this.toolCalls = 0,
    this.toolResults = 0,
    this.totalMessages = 0,
    this.tokens = const PiTokenUsage(),
    this.cost = 0,
    this.contextUsage,
  });

  factory PiSessionStats.fromJson(Map<String, dynamic> json) {
    final contextUsageJson = json['contextUsage'] as Map<String, dynamic>?;
    return PiSessionStats(
      sessionFile: json['sessionFile'] as String?,
      sessionId: json['sessionId'] as String? ?? '',
      userMessages: json['userMessages'] as int? ?? 0,
      assistantMessages: json['assistantMessages'] as int? ?? 0,
      toolCalls: json['toolCalls'] as int? ?? 0,
      toolResults: json['toolResults'] as int? ?? 0,
      totalMessages: json['totalMessages'] as int? ?? 0,
      tokens: PiTokenUsage.fromJson(
        json['tokens'] as Map<String, dynamic>? ?? const {},
      ),
      cost: (json['cost'] as num?)?.toDouble() ?? 0,
      contextUsage: contextUsageJson != null
          ? PiContextUsage.fromJson(contextUsageJson)
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (sessionFile != null) 'sessionFile': sessionFile,
      'sessionId': sessionId,
      'userMessages': userMessages,
      'assistantMessages': assistantMessages,
      'toolCalls': toolCalls,
      'toolResults': toolResults,
      'totalMessages': totalMessages,
      'tokens': tokens.toJson(),
      'cost': cost,
    };
  }
}

class PiTreeNavigateResult {
  final String? editorText;
  final bool cancelled;
  final bool aborted;

  const PiTreeNavigateResult({
    this.editorText,
    required this.cancelled,
    this.aborted = false,
  });

  factory PiTreeNavigateResult.fromJson(Map<String, dynamic> json) {
    return PiTreeNavigateResult(
      editorText: json['editorText'] as String?,
      cancelled: json['cancelled'] as bool? ?? false,
      aborted: json['aborted'] as bool? ?? false,
    );
  }
}

class PiStreamMessage {
  final String type;
  final Map<String, dynamic> raw;
  final String? sessionId;

  const PiStreamMessage({
    required this.type,
    required this.raw,
    this.sessionId,
  });

  factory PiStreamMessage.fromJson(Map<String, dynamic> json) {
    return PiStreamMessage(
      type: json['type'] as String? ?? 'unknown',
      raw: json,
      sessionId: json['sessionId'] as String?,
    );
  }

  String? get textDelta =>
      type == 'text-delta' ? raw['content'] as String? : null;

  String? get thinkingDelta =>
      type == 'thinking-delta' ? raw['content'] as String? : null;

  String? get errorMessage =>
      type == 'error' ? raw['message'] as String? : null;

  String? get extensionUiMethod =>
      type == 'extension-ui-request' ? raw['method'] as String? : null;

  String? get extensionUiRequestId =>
      type == 'extension-ui-request' ? raw['id'] as String? : null;

  bool get isError => type == 'error';
}
