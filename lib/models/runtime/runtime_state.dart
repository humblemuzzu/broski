import '../agent_type.dart';
import 'runtime_capabilities.dart';
import 'runtime_model_summary.dart';

class RuntimePermissionRequest {
  final String? requestId;
  final String? kind;
  final String? title;
  final String? message;
  final List<String> options;
  final Map<String, dynamic>? metadata;

  const RuntimePermissionRequest({
    this.requestId,
    this.kind,
    this.title,
    this.message,
    this.options = const [],
    this.metadata,
  });

  factory RuntimePermissionRequest.fromJson(Map<String, dynamic> json) {
    return RuntimePermissionRequest(
      requestId: json['requestId'] as String?,
      kind: json['kind'] as String?,
      title: json['title'] as String?,
      message: json['message'] as String?,
      options: (json['options'] as List<dynamic>? ?? const [])
          .map((entry) => entry.toString())
          .toList(),
      metadata: _asMap(json['metadata']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (requestId != null) 'requestId': requestId,
      if (kind != null) 'kind': kind,
      if (title != null) 'title': title,
      if (message != null) 'message': message,
      if (options.isNotEmpty) 'options': options,
      if (metadata != null) 'metadata': metadata,
    };
  }
}

class RuntimeUserInputRequest {
  final String? requestId;
  final String? kind;
  final String? title;
  final String? prompt;
  final String? placeholder;
  final List<String> options;
  final Map<String, dynamic>? metadata;

  const RuntimeUserInputRequest({
    this.requestId,
    this.kind,
    this.title,
    this.prompt,
    this.placeholder,
    this.options = const [],
    this.metadata,
  });

  factory RuntimeUserInputRequest.fromJson(Map<String, dynamic> json) {
    return RuntimeUserInputRequest(
      requestId: json['requestId'] as String?,
      kind: json['kind'] as String?,
      title: json['title'] as String?,
      prompt: json['prompt'] as String?,
      placeholder: json['placeholder'] as String?,
      options: (json['options'] as List<dynamic>? ?? const [])
          .map((entry) => entry.toString())
          .toList(),
      metadata: _asMap(json['metadata']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (requestId != null) 'requestId': requestId,
      if (kind != null) 'kind': kind,
      if (title != null) 'title': title,
      if (prompt != null) 'prompt': prompt,
      if (placeholder != null) 'placeholder': placeholder,
      if (options.isNotEmpty) 'options': options,
      if (metadata != null) 'metadata': metadata,
    };
  }
}

class RuntimeState {
  final AgentType backend;
  final String? sessionId;
  final String? cwd;
  final bool isStreaming;
  final bool isCompacting;
  final bool isRetrying;
  final int? pendingMessageCount;
  final RuntimeModelSummary? model;
  final String? thinkingLevel;
  final RuntimePermissionRequest? permissionRequest;
  final RuntimeCapabilities capabilities;
  final Map<String, dynamic>? backendData;

  const RuntimeState({
    required this.backend,
    this.sessionId,
    this.cwd,
    this.isStreaming = false,
    this.isCompacting = false,
    this.isRetrying = false,
    this.pendingMessageCount,
    this.model,
    this.thinkingLevel,
    this.permissionRequest,
    this.capabilities = const RuntimeCapabilities(),
    this.backendData,
  });

  factory RuntimeState.fromJson(Map<String, dynamic> json) {
    final modelJson = _asMap(json['model']);
    final permissionJson = _asMap(json['permissionRequest']);
    return RuntimeState(
      backend: AgentType.fromWireValue(
        json['backend'] as String? ?? 'opencode',
      ),
      sessionId: json['sessionId'] as String?,
      cwd: json['cwd'] as String?,
      isStreaming: json['isStreaming'] as bool? ?? false,
      isCompacting: json['isCompacting'] as bool? ?? false,
      isRetrying: json['isRetrying'] as bool? ?? false,
      pendingMessageCount: (json['pendingMessageCount'] as num?)?.toInt(),
      model: modelJson == null ? null : RuntimeModelSummary.fromJson(modelJson),
      thinkingLevel: json['thinkingLevel'] as String?,
      permissionRequest: permissionJson == null
          ? null
          : RuntimePermissionRequest.fromJson(permissionJson),
      capabilities: RuntimeCapabilities.fromJson(
        _asMap(json['capabilities']) ?? const {},
      ),
      backendData: _asMap(json['backendData']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'backend': backend.wireValue,
      if (sessionId != null) 'sessionId': sessionId,
      if (cwd != null) 'cwd': cwd,
      'isStreaming': isStreaming,
      'isCompacting': isCompacting,
      'isRetrying': isRetrying,
      if (pendingMessageCount != null)
        'pendingMessageCount': pendingMessageCount,
      if (model != null) 'model': model!.toJson(),
      if (thinkingLevel != null) 'thinkingLevel': thinkingLevel,
      if (permissionRequest != null)
        'permissionRequest': permissionRequest!.toJson(),
      'capabilities': capabilities.toJson(),
      if (backendData != null) 'backendData': backendData,
    };
  }
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
