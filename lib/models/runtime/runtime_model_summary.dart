import 'package:broski/models/agent_type.dart';

class RuntimeModelSummary {
  final String id;
  final AgentType backend;
  final String label;
  final String? providerId;
  final int? contextWindow;
  final int? maxOutputTokens;
  final bool? supportsReasoning;
  final bool? supportsImages;
  final bool? supportsTools;
  final bool? supportsMcp;
  final Map<String, dynamic>? backendData;

  const RuntimeModelSummary({
    required this.id,
    required this.backend,
    required this.label,
    this.providerId,
    this.contextWindow,
    this.maxOutputTokens,
    this.supportsReasoning,
    this.supportsImages,
    this.supportsTools,
    this.supportsMcp,
    this.backendData,
  });

  factory RuntimeModelSummary.fromJson(Map<String, dynamic> json) {
    return RuntimeModelSummary(
      id: json['id'] as String? ?? '',
      backend: AgentType.fromWireValue(
        json['backend'] as String? ?? 'claude-code',
      ),
      label: json['label'] as String? ?? '',
      providerId: json['providerId'] as String?,
      contextWindow: (json['contextWindow'] as num?)?.toInt(),
      maxOutputTokens: (json['maxOutputTokens'] as num?)?.toInt(),
      supportsReasoning: json['supportsReasoning'] as bool?,
      supportsImages: json['supportsImages'] as bool?,
      supportsTools: json['supportsTools'] as bool?,
      supportsMcp: json['supportsMcp'] as bool?,
      backendData: _asMap(json['backendData']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'backend': backend.wireValue,
      'label': label,
      if (providerId != null) 'providerId': providerId,
      if (contextWindow != null) 'contextWindow': contextWindow,
      if (maxOutputTokens != null) 'maxOutputTokens': maxOutputTokens,
      if (supportsReasoning != null) 'supportsReasoning': supportsReasoning,
      if (supportsImages != null) 'supportsImages': supportsImages,
      if (supportsTools != null) 'supportsTools': supportsTools,
      if (supportsMcp != null) 'supportsMcp': supportsMcp,
      if (backendData != null) 'backendData': backendData,
    };
  }
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
