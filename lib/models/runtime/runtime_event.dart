import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime_state.dart';

sealed class RuntimeEvent {
  final String type;
  final AgentType backend;
  final int timestampMs;
  final String? sessionId;
  final String? cwd;
  final String? messageId;
  final String? toolCallId;
  final String? streamId;
  final String? turnId;
  final int? seq;
  final bool replayed;
  final Map<String, dynamic>? backendData;

  const RuntimeEvent({
    required this.type,
    required this.backend,
    required this.timestampMs,
    this.sessionId,
    this.cwd,
    this.messageId,
    this.toolCallId,
    this.streamId,
    this.turnId,
    this.seq,
    this.replayed = false,
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
        return RuntimeBackendEvent._({
          ...json,
          'kind': 'unknown',
          'payload': json,
        });
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
    if (streamId != null) 'streamId': streamId,
    if (turnId != null) 'turnId': turnId,
    if (seq != null) 'seq': seq,
    if (replayed) 'replayed': replayed,
    if (backendData != null) 'backendData': backendData,
  };
}

class RuntimeAgentStartedEvent extends RuntimeEvent {
  RuntimeAgentStartedEvent._(Map<String, dynamic> json)
    : super(
        type: 'agent_started',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => toEnvelopeJson();
}

class RuntimeAgentFinishedEvent extends RuntimeEvent {
  final String? stopReason;

  RuntimeAgentFinishedEvent._(Map<String, dynamic> json)
    : stopReason = json['stopReason'] as String?,
      super(
        type: 'agent_finished',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (stopReason != null) 'stopReason': stopReason,
  };
}

class RuntimeAssistantTextDeltaEvent extends RuntimeEvent {
  final String delta;

  RuntimeAssistantTextDeltaEvent._(Map<String, dynamic> json)
    : delta = json['delta'] as String? ?? '',
      super(
        type: 'assistant_text_delta',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {...toEnvelopeJson(), 'delta': delta};
}

class RuntimeAssistantThinkingDeltaEvent extends RuntimeEvent {
  final String delta;

  RuntimeAssistantThinkingDeltaEvent._(Map<String, dynamic> json)
    : delta = json['delta'] as String? ?? '',
      super(
        type: 'assistant_thinking_delta',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {...toEnvelopeJson(), 'delta': delta};
}

class RuntimeToolStartedEvent extends RuntimeEvent {
  final String? toolName;
  final Object? input;

  RuntimeToolStartedEvent._(Map<String, dynamic> json)
    : toolName = json['toolName'] as String?,
      input = json['input'],
      super(
        type: 'tool_started',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (toolName != null) 'toolName': toolName,
    if (input != null) 'input': input,
  };
}

class RuntimeToolUpdatedEvent extends RuntimeEvent {
  final String? toolName;
  final Object? input;
  final Object? partialOutput;

  RuntimeToolUpdatedEvent._(Map<String, dynamic> json)
    : toolName = json['toolName'] as String?,
      input = json['input'],
      partialOutput = json['partialOutput'],
      super(
        type: 'tool_updated',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (toolName != null) 'toolName': toolName,
    if (input != null) 'input': input,
    if (partialOutput != null) 'partialOutput': partialOutput,
  };
}

class RuntimeToolFinishedEvent extends RuntimeEvent {
  final String? toolName;
  final Object? input;
  final Object? output;
  final bool? isError;

  RuntimeToolFinishedEvent._(Map<String, dynamic> json)
    : toolName = json['toolName'] as String?,
      input = json['input'],
      output = json['output'],
      isError = json['isError'] as bool?,
      super(
        type: 'tool_finished',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (toolName != null) 'toolName': toolName,
    if (input != null) 'input': input,
    if (output != null) 'output': output,
    if (isError != null) 'isError': isError,
  };
}

class RuntimePermissionRequestedEvent extends RuntimeEvent {
  final RuntimePermissionRequest request;

  RuntimePermissionRequestedEvent._(Map<String, dynamic> json)
    : request = RuntimePermissionRequest.fromJson(
        _asMap(json['request']) ?? <String, dynamic>{},
      ),
      super(
        type: 'permission_requested',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'request': request.toJson(),
  };
}

class RuntimeUserInputRequestedEvent extends RuntimeEvent {
  final RuntimeUserInputRequest request;

  RuntimeUserInputRequestedEvent._(Map<String, dynamic> json)
    : request = RuntimeUserInputRequest.fromJson(
        _asMap(json['request']) ?? <String, dynamic>{},
      ),
      super(
        type: 'user_input_requested',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'request': request.toJson(),
  };
}

class RuntimeSessionStateChangedEvent extends RuntimeEvent {
  final RuntimeState state;

  RuntimeSessionStateChangedEvent._(Map<String, dynamic> json)
    : state = RuntimeState.fromJson(
        _asMap(json['state']) ?? <String, dynamic>{},
      ),
      super(
        type: 'session_state_changed',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'state': state.toJson(),
  };
}

class RuntimeCompactionStartedEvent extends RuntimeEvent {
  final String? reason;

  RuntimeCompactionStartedEvent._(Map<String, dynamic> json)
    : reason = json['reason'] as String?,
      super(
        type: 'compaction_started',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (reason != null) 'reason': reason,
  };
}

class RuntimeCompactionFinishedEvent extends RuntimeEvent {
  final bool? aborted;
  final bool? willRetry;
  final String? errorMessage;

  RuntimeCompactionFinishedEvent._(Map<String, dynamic> json)
    : aborted = json['aborted'] as bool?,
      willRetry = json['willRetry'] as bool?,
      errorMessage = json['errorMessage'] as String?,
      super(
        type: 'compaction_finished',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (aborted != null) 'aborted': aborted,
    if (willRetry != null) 'willRetry': willRetry,
    if (errorMessage != null) 'errorMessage': errorMessage,
  };
}

class RuntimeRetryStartedEvent extends RuntimeEvent {
  final int? attempt;
  final int? maxAttempts;
  final int? delayMs;
  final String? errorMessage;

  RuntimeRetryStartedEvent._(Map<String, dynamic> json)
    : attempt = (json['attempt'] as num?)?.toInt(),
      maxAttempts = (json['maxAttempts'] as num?)?.toInt(),
      delayMs = (json['delayMs'] as num?)?.toInt(),
      errorMessage = json['errorMessage'] as String?,
      super(
        type: 'retry_started',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (attempt != null) 'attempt': attempt,
    if (maxAttempts != null) 'maxAttempts': maxAttempts,
    if (delayMs != null) 'delayMs': delayMs,
    if (errorMessage != null) 'errorMessage': errorMessage,
  };
}

class RuntimeRetryFinishedEvent extends RuntimeEvent {
  final bool? success;
  final int? attempt;
  final String? finalError;

  RuntimeRetryFinishedEvent._(Map<String, dynamic> json)
    : success = json['success'] as bool?,
      attempt = (json['attempt'] as num?)?.toInt(),
      finalError = json['finalError'] as String?,
      super(
        type: 'retry_finished',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    if (success != null) 'success': success,
    if (attempt != null) 'attempt': attempt,
    if (finalError != null) 'finalError': finalError,
  };
}

class RuntimeErrorEvent extends RuntimeEvent {
  final String message;
  final String? code;
  final Object? details;

  RuntimeErrorEvent._(Map<String, dynamic> json)
    : message = json['message'] as String? ?? '',
      code = json['code'] as String?,
      details = json['details'],
      super(
        type: 'error',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'message': message,
    if (code != null) 'code': code,
    if (details != null) 'details': details,
  };
}

class RuntimeBackendEvent extends RuntimeEvent {
  final String kind;
  final Object? payload;

  RuntimeBackendEvent._(Map<String, dynamic> json)
    : kind = json['kind'] as String? ?? '',
      payload = json['payload'],
      super(
        type: 'backend_event',
        backend: _backendFromJson(json),
        timestampMs: _timestampFromJson(json),
        sessionId: _stringField(json, 'sessionId'),
        cwd: _stringField(json, 'cwd'),
        messageId: _stringField(json, 'messageId'),
        toolCallId: _stringField(json, 'toolCallId'),
        streamId: _stringField(json, 'streamId'),
        turnId: _stringField(json, 'turnId'),
        seq: (json['seq'] as num?)?.toInt(),
        replayed: json['replayed'] as bool? ?? false,
        backendData: _asMap(json['backendData']),
      );

  @override
  Map<String, dynamic> toJson() => {
    ...toEnvelopeJson(),
    'kind': kind,
    if (payload != null) 'payload': payload,
  };
}

AgentType _backendFromJson(Map<String, dynamic> json) {
  return AgentType.fromWireValue(json['backend'] as String? ?? 'opencode');
}

int _timestampFromJson(Map<String, dynamic> json) {
  return (json['timestampMs'] as num?)?.toInt() ?? 0;
}

String? _stringField(Map<String, dynamic> json, String key) {
  return json[key] as String?;
}

Map<String, dynamic>? _asMap(dynamic value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}
