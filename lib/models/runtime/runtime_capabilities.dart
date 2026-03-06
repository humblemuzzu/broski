class RuntimeCapabilities {
  final bool canStreamText;
  final bool canStreamThinking;
  final bool canUseTools;
  final bool canPrompt;
  final bool canAbort;
  final bool canSwitchModel;
  final bool canListSessions;
  final bool canReadTranscript;
  final bool canForkSession;
  final bool canCompact;
  final bool canRetry;
  final bool canRequestUserInput;
  final bool canRequestPermissions;
  final List<String> backendExtras;

  const RuntimeCapabilities({
    this.canStreamText = false,
    this.canStreamThinking = false,
    this.canUseTools = false,
    this.canPrompt = false,
    this.canAbort = false,
    this.canSwitchModel = false,
    this.canListSessions = false,
    this.canReadTranscript = false,
    this.canForkSession = false,
    this.canCompact = false,
    this.canRetry = false,
    this.canRequestUserInput = false,
    this.canRequestPermissions = false,
    this.backendExtras = const [],
  });

  factory RuntimeCapabilities.fromJson(Map<String, dynamic> json) {
    return RuntimeCapabilities(
      canStreamText: json['canStreamText'] as bool? ?? false,
      canStreamThinking: json['canStreamThinking'] as bool? ?? false,
      canUseTools: json['canUseTools'] as bool? ?? false,
      canPrompt: json['canPrompt'] as bool? ?? false,
      canAbort: json['canAbort'] as bool? ?? false,
      canSwitchModel: json['canSwitchModel'] as bool? ?? false,
      canListSessions: json['canListSessions'] as bool? ?? false,
      canReadTranscript: json['canReadTranscript'] as bool? ?? false,
      canForkSession: json['canForkSession'] as bool? ?? false,
      canCompact: json['canCompact'] as bool? ?? false,
      canRetry: json['canRetry'] as bool? ?? false,
      canRequestUserInput: json['canRequestUserInput'] as bool? ?? false,
      canRequestPermissions: json['canRequestPermissions'] as bool? ?? false,
      backendExtras: (json['backendExtras'] as List<dynamic>? ?? const [])
          .map((entry) => entry.toString())
          .toList(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'canStreamText': canStreamText,
      'canStreamThinking': canStreamThinking,
      'canUseTools': canUseTools,
      'canPrompt': canPrompt,
      'canAbort': canAbort,
      'canSwitchModel': canSwitchModel,
      'canListSessions': canListSessions,
      'canReadTranscript': canReadTranscript,
      'canForkSession': canForkSession,
      'canCompact': canCompact,
      'canRetry': canRetry,
      'canRequestUserInput': canRequestUserInput,
      'canRequestPermissions': canRequestPermissions,
      'backendExtras': backendExtras,
    };
  }
}
