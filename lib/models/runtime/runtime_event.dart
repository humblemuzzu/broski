import '../agent_type.dart';
import 'runtime_state.dart';

sealed class RuntimeEvent {
  final String type;
  final AgentType backend;
  final int timestampMs;
  final String? sessionId;
  final String? cwd;
  final String? messageId;
  final String? toolCallId;
  final Map<String, dynamic>? backendData;

  const RuntimeEvent({
    required this.type,
    required this.backend,
    required this.timestampMs,
    this.sessionId,
    this.cwd,
    this.messageId,
    this.toolCallId,
    this.backendData,
  });

  factory RuntimeEvent.fromJson(Map<String, dynamic> json) {
    switch (json['type'] as String? ?? '') {
      case 'agent_started':
        return RuntimeAgentStartedEvent._(json);
      case 'agent_finished':
        return RuntimeAgentFinishedEvent._(json);
      case 'assistant_text_delta':
        return RuntimeAssistantTextDeltaEvent._(json);
      case 'assistant_thinking_delta':
        return RuntimeAssistantThinkingDeltaEvent._(json);
      case 'tool_started':
        return RuntimeToolStartedEvent._(json);
      case 'tool_updated':
        return RuntimeToolUpdatedEvent._(json);
      case 'tool_finished':
        return RuntimeToolFinishedEvent._(json);
      case 'permission_requested':
        return RuntimePermissionRequestedEvent._(json);
      case 'user_input_requested':
        return RuntimeUserInputRequestedEvent._(json);
      case 'session_state_changed':
        return RuntimeSessionStateChangedEvent._(json);
      case 'compaction_started':
        return RuntimeCompactionStartedEvent._(json);
      case 'compaction_finished':
        return RuntimeCompactionFinishedEvent._(json);
      case 'retry_started':
        return RuntimeRetryStartedEvent._(json);
      case 'retry_finished':
        return RuntimeRetryFinishedEvent._(json);
      case 'error':
        return RuntimeErrorEvent._(json);
      case 'backend_event':
        return RuntimeBackendEvent._(json);
      default:
        throw FormatException('Unknown runtime event type: ${json['type']}');
    }
  }

  Map<String, dynamic> toJson();

  Map<String, dynamic> toEnvelopeJson() => {
    'type': type,
    'backend': backend.wireValue,
    'timestampMs': timestampMs,
    if (sessionId != null) 'sessionId': sessionId,
    if (cwd != null) 'cwd': cwd,
    if (messageId != null) 'messageId': messageId,
    if (toolCallId != null) 'toolCallId': toolCallId,
    if (backendData != null) 'backendData': backendData,
  };
}

abstract class _JsonRuntimeEvent extends RuntimeEvent {
  _JsonRuntimeEvent({required super.type, required Map<String, dynamic> json})
    : super(
        backend: AgentType.fromWireValue(
          json['backend'] as String? ?? 'opencode',
        ),
        timestampMs: (json['timestampMs'] as num?)?.toInt() ?? 0,
        sessionId: json['sessionId'] as String?,
        cwd: json['cwd'] as String?,
        messageId: json['messageId'] as String?,
        toolCallId: json['toolCallId'] as String?,
        backendData: _asMap(json['backendData']),
      );
}

abstract class _JsonEmptyRuntimeEvent extends _JsonRuntimeEvent {
  _JsonEmptyRuntimeEvent({required super.type, required super.json});
  @override
  Map<String, dynamic> toJson() => toEnvelopeJson();
}

abstract class _JsonDeltaRuntimeEvent extends _JsonRuntimeEvent {
  final String delta;
  _JsonDeltaRuntimeEvent({required super.type, required super.json})
    : delta = json['delta'] as String? ?? '';
  @override
  Map<String, dynamic> toJson() => {...toEnvelopeJson(), 'delta': delta};
}

abstract class _JsonToolRuntimeEvent extends _JsonRuntimeEvent {
  final String? toolName;
  final Object? input;
  _JsonToolRuntimeEvent({required super.type, required super.json})
    : toolName = json['toolName'] as String?,
      input = json['input'];
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (toolName != null) 'toolName': toolName,
    if (input != null) 'input': input,
  };
}

class RuntimeAgentStartedEvent extends _JsonEmptyRuntimeEvent {
  RuntimeAgentStartedEvent._(Map<String, dynamic> json)
    : super(type: 'agent_started', json: json);
}

class RuntimeAgentFinishedEvent extends _JsonRuntimeEvent {
  final String? stopReason;
  RuntimeAgentFinishedEvent._(Map<String, dynamic> json)
    : stopReason = json['stopReason'] as String?,
      super(type: 'agent_finished', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (stopReason != null) 'stopReason': stopReason,
  };
}

class RuntimeAssistantTextDeltaEvent extends _JsonDeltaRuntimeEvent {
  RuntimeAssistantTextDeltaEvent._(Map<String, dynamic> json)
    : super(type: 'assistant_text_delta', json: json);
}

class RuntimeAssistantThinkingDeltaEvent extends _JsonDeltaRuntimeEvent {
  RuntimeAssistantThinkingDeltaEvent._(Map<String, dynamic> json)
    : super(type: 'assistant_thinking_delta', json: json);
}

class RuntimeToolStartedEvent extends _JsonToolRuntimeEvent {
  RuntimeToolStartedEvent._(Map<String, dynamic> json)
    : super(type: 'tool_started', json: json);
}

class RuntimeToolUpdatedEvent extends _JsonToolRuntimeEvent {
  final Object? partialOutput;
  RuntimeToolUpdatedEvent._(Map<String, dynamic> json)
    : partialOutput = json['partialOutput'],
      super(type: 'tool_updated', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...super.toJson(),
    if (partialOutput != null) 'partialOutput': partialOutput,
  };
}

class RuntimeToolFinishedEvent extends _JsonToolRuntimeEvent {
  final Object? output;
  final bool? isError;
  RuntimeToolFinishedEvent._(Map<String, dynamic> json)
    : output = json['output'],
      isError = json['isError'] as bool?,
      super(type: 'tool_finished', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...super.toJson(),
    if (output != null) 'output': output,
    if (isError != null) 'isError': isError,
  };
}

class RuntimePermissionRequestedEvent extends _JsonRuntimeEvent {
  final RuntimePermissionRequest request;
  RuntimePermissionRequestedEvent._(Map<String, dynamic> json)
    : request = RuntimePermissionRequest.fromJson(
        _asMap(json['request']) ?? <String, dynamic>{},
      ),
      super(type: 'permission_requested', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'request': request.toJson(),
  };
}

class RuntimeUserInputRequestedEvent extends _JsonRuntimeEvent {
  final RuntimeUserInputRequest request;
  RuntimeUserInputRequestedEvent._(Map<String, dynamic> json)
    : request = RuntimeUserInputRequest.fromJson(
        _asMap(json['request']) ?? <String, dynamic>{},
      ),
      super(type: 'user_input_requested', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'request': request.toJson(),
  };
}

class RuntimeSessionStateChangedEvent extends _JsonRuntimeEvent {
  final RuntimeState state;
  RuntimeSessionStateChangedEvent._(Map<String, dynamic> json)
    : state = RuntimeState.fromJson(
        _asMap(json['state']) ?? <String, dynamic>{},
      ),
      super(type: 'session_state_changed', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'state': state.toJson(),
  };
}

class RuntimeCompactionStartedEvent extends _JsonRuntimeEvent {
  final String? reason;
  RuntimeCompactionStartedEvent._(Map<String, dynamic> json)
    : reason = json['reason'] as String?,
      super(type: 'compaction_started', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (reason != null) 'reason': reason,
  };
}

class RuntimeCompactionFinishedEvent extends _JsonRuntimeEvent {
  final bool? aborted;
  final bool? willRetry;
  final String? errorMessage;
  RuntimeCompactionFinishedEvent._(Map<String, dynamic> json)
    : aborted = json['aborted'] as bool?,
      willRetry = json['willRetry'] as bool?,
      errorMessage = json['errorMessage'] as String?,
      super(type: 'compaction_finished', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (aborted != null) 'aborted': aborted,
    if (willRetry != null) 'willRetry': willRetry,
    if (errorMessage != null) 'errorMessage': errorMessage,
  };
}

class RuntimeRetryStartedEvent extends _JsonRuntimeEvent {
  final int? attempt;
  final int? maxAttempts;
  final int? delayMs;
  final String? errorMessage;
  RuntimeRetryStartedEvent._(Map<String, dynamic> json)
    : attempt = (json['attempt'] as num?)?.toInt(),
      maxAttempts = (json['maxAttempts'] as num?)?.toInt(),
      delayMs = (json['delayMs'] as num?)?.toInt(),
      errorMessage = json['errorMessage'] as String?,
      super(type: 'retry_started', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (attempt != null) 'attempt': attempt,
    if (maxAttempts != null) 'maxAttempts': maxAttempts,
    if (delayMs != null) 'delayMs': delayMs,
    if (errorMessage != null) 'errorMessage': errorMessage,
  };
}

class RuntimeRetryFinishedEvent extends _JsonRuntimeEvent {
  final bool? success;
  final int? attempt;
  final String? finalError;
  RuntimeRetryFinishedEvent._(Map<String, dynamic> json)
    : success = json['success'] as bool?,
      attempt = (json['attempt'] as num?)?.toInt(),
      finalError = json['finalError'] as String?,
      super(type: 'retry_finished', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (success != null) 'success': success,
    if (attempt != null) 'attempt': attempt,
    if (finalError != null) 'finalError': finalError,
  };
}

class RuntimeErrorEvent extends _JsonRuntimeEvent {
  final String message;
  final String? code;
  final Object? details;
  RuntimeErrorEvent._(Map<String, dynamic> json)
    : message = json['message'] as String? ?? '',
      code = json['code'] as String?,
      details = json['details'],
      super(type: 'error', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'message': message,
    if (code != null) 'code': code,
    if (details != null) 'details': details,
  };
}

class RuntimeBackendEvent extends _JsonRuntimeEvent {
  final String kind;
  final Object? payload;
  RuntimeBackendEvent._(Map<String, dynamic> json)
    : kind = json['kind'] as String? ?? '',
      payload = json['payload'],
      super(type: 'backend_event', json: json);
  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'kind': kind,
    if (payload != null) 'payload': payload,
  };
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
