import 'dart:async';

import '../models/file_attachment.dart';
import '../models/pi.dart';
import 'websocket_service.dart';

export 'bridge/bridge_pi_tools.dart';

class PiBridgeService {
  PiBridgeService(this._socket) {
    _dispatcherSub = _socket.messages.listen(_dispatchMessage);
  }

  final WebSocketService _socket;
  late final StreamSubscription<Map<String, dynamic>> _dispatcherSub;

  int _requestCounter = 0;
  final Map<String, Completer<Map<String, dynamic>>> _pendingByRequestId = {};

  static const _requestIdPrefix = 'pi_req_';

  Stream<PiStreamMessage> get streamMessages => _socket.messages
      .where((message) => message['type'] == 'pi_stream')
      .map((message) {
        final data = message['data'];
        if (data is Map<String, dynamic>) {
          return PiStreamMessage.fromJson({
            ...data,
            if (message['sessionId'] is String)
              'sessionId': message['sessionId'] as String,
          });
        }
        return const PiStreamMessage(type: 'unknown', raw: {});
      });

  void _dispatchMessage(Map<String, dynamic> message) {
    final requestId = message['requestId'];
    if (requestId is! String || !requestId.startsWith(_requestIdPrefix)) {
      return;
    }

    final completer = _pendingByRequestId.remove(requestId);
    if (completer != null && !completer.isCompleted) {
      completer.complete(message);
    }
  }

  void dispose() {
    _dispatcherSub.cancel();
    for (final entry in _pendingByRequestId.entries) {
      if (!entry.value.isCompleted) {
        entry.value.completeError(
          StateError('PiBridgeService disposed while waiting for response'),
        );
      }
    }
    _pendingByRequestId.clear();
  }

  /// Internal: generate a unique request ID (for extensions).
  String generateRequestId() => _generateRequestId();

  /// Internal: send a message via the socket (for extensions).
  void sendMessage(Map<String, dynamic> message) => _socket.send(message);

  /// Internal: wait for a response message (for extensions).
  Future<Map<String, dynamic>> waitForResponse(
    String expectedType, {
    required String requestId,
    Duration timeout = const Duration(seconds: 30),
  }) => _waitFor(expectedType, requestId: requestId, timeout: timeout);

  String _generateRequestId() {
    _requestCounter++;
    return '$_requestIdPrefix${DateTime.now().millisecondsSinceEpoch}_$_requestCounter';
  }

  Future<Map<String, dynamic>> _waitFor(
    String expectedType, {
    required String requestId,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final existing = _pendingByRequestId[requestId];
    if (existing != null) {
      return existing.future;
    }

    final completer = Completer<Map<String, dynamic>>();
    _pendingByRequestId[requestId] = completer;

    Timer(timeout, () {
      final pending = _pendingByRequestId.remove(requestId);
      if (pending != null && !pending.isCompleted) {
        pending.completeError(
          TimeoutException(
            'Timed out waiting for response type "$expectedType" (requestId=$requestId)',
          ),
        );
      }
    });

    final response = await completer.future;
    final actualType = response['type'] as String?;

    if (actualType == 'error') {
      throw Exception(response['message'] ?? 'Unknown bridge error');
    }

    if (actualType != expectedType) {
      throw StateError(
        'Expected response type "$expectedType", got "$actualType"',
      );
    }

    return response;
  }

  Future<PiState> getState({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_state',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_state', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiState.fromJson(data);
  }

  Future<void> chat({
    required String prompt,
    String? projectPath,
    List<FileAttachment>? fileAttachments,
    String? streamingBehavior,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_chat',
      'requestId': requestId,
      'prompt': prompt,
      if (projectPath != null) 'projectPath': projectPath,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments
            .map((attachment) => attachment.toJson())
            .toList(),
      if (streamingBehavior != null) 'streamingBehavior': streamingBehavior,
    });

    await _waitFor('pi_chat_started', requestId: requestId);
  }

  Future<void> steer({
    required String message,
    String? projectPath,
    List<FileAttachment>? fileAttachments,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_steer',
      'requestId': requestId,
      'message': message,
      if (projectPath != null) 'projectPath': projectPath,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments
            .map((attachment) => attachment.toJson())
            .toList(),
    });

    await _waitFor('pi_steered', requestId: requestId);
  }

  Future<void> followUp({
    required String message,
    String? projectPath,
    List<FileAttachment>? fileAttachments,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_follow_up',
      'requestId': requestId,
      'message': message,
      if (projectPath != null) 'projectPath': projectPath,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments
            .map((attachment) => attachment.toJson())
            .toList(),
    });

    await _waitFor('pi_followed_up', requestId: requestId);
  }

  Future<void> abort({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_abort',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    await _waitFor('pi_aborted', requestId: requestId);
  }

  Future<String> setSteeringMode({
    required String mode,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_steering_mode',
      'requestId': requestId,
      'mode': mode,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_steering_mode_set',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['mode'] as String? ?? mode;
  }

  Future<String> setFollowUpMode({
    required String mode,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_follow_up_mode',
      'requestId': requestId,
      'mode': mode,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_follow_up_mode_set',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['mode'] as String? ?? mode;
  }

  Future<bool> setAutoRetry({
    required bool enabled,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_auto_retry',
      'requestId': requestId,
      'enabled': enabled,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_auto_retry_set', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<void> abortRetry({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_abort_retry',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    await _waitFor('pi_retry_aborted', requestId: requestId);
  }

  Future<List<PiModel>> listModels({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_list_models',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_models', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiModel.fromJson(entry))
        .toList();
  }

  Future<PiModel?> setModel({
    required String provider,
    required String modelId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_model',
      'requestId': requestId,
      'provider': provider,
      'modelId': modelId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_model_set', requestId: requestId);
    final data = response['data'];
    if (data is! Map<String, dynamic>) return null;
    return PiModel.fromJson(data);
  }

  Future<PiThinkingLevel> setThinkingLevel({
    required PiThinkingLevel level,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_thinking_level',
      'requestId': requestId,
      'level': level.wireValue,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_thinking_level', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiThinkingLevel.fromWireValue(data['level'] as String? ?? 'medium');
  }

  Future<PiThinkingLevel> cycleThinkingLevel({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_cycle_thinking_level',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_thinking_level', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiThinkingLevel.fromWireValue(data['level'] as String? ?? 'medium');
  }

  Future<({PiModel? model, bool isScoped})> cycleModel({
    String? projectPath,
    String? direction,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_cycle_model',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (direction != null) 'direction': direction,
    });

    final response = await _waitFor('pi_model_set', requestId: requestId);
    final data = response['data'];
    final model = data is Map<String, dynamic> ? PiModel.fromJson(data) : null;
    final isScoped = response['isScoped'] as bool? ?? false;
    return (model: model, isScoped: isScoped);
  }

  Future<List<PiSessionInfo>> listSessions({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_list_sessions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiSessionInfo.fromJson(entry))
        .toList();
  }

  Future<bool> newSession({
    String? projectPath,
    String? name,
    String? provider,
    String? modelId,
    String? thinkingLevel,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_new_session',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (name != null) 'name': name,
      if (provider != null) 'provider': provider,
      if (modelId != null) 'modelId': modelId,
      if (thinkingLevel != null) 'thinkingLevel': thinkingLevel,
    });

    final response = await _waitFor('pi_session_created', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<bool> switchSession({
    required String sessionPath,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_switch_session',
      'requestId': requestId,
      'sessionPath': sessionPath,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_session_switched',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  Future<bool> deleteSession({
    required String sessionPath,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_delete_session',
      'requestId': requestId,
      'sessionPath': sessionPath,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_session_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<List<Map<String, dynamic>>> getMessages({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_messages',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_messages', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<PiSessionStats> getSessionStats({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_session_stats',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_session_stats', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiSessionStats.fromJson(data);
  }

  Future<bool> setSessionName({
    required String name,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_session_name',
      'requestId': requestId,
      'name': name,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_session_name_set',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  Future<({String text, bool cancelled})> fork({
    required String entryId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_fork',
      'requestId': requestId,
      'entryId': entryId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_fork_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return (
      text: data['text'] as String? ?? '',
      cancelled: data['cancelled'] as bool? ?? false,
    );
  }

  Future<List<PiForkMessage>> getForkMessages({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_fork_messages',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_fork_messages', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiForkMessage.fromJson(entry))
        .toList();
  }

  Future<PiTreeNavigateResult> navigateTree({
    required String targetId,
    bool summarize = false,
    String? customInstructions,
    bool replaceInstructions = false,
    String? label,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_navigate_tree',
      'requestId': requestId,
      'targetId': targetId,
      'summarize': summarize,
      'replaceInstructions': replaceInstructions,
      if (customInstructions != null) 'customInstructions': customInstructions,
      if (label != null) 'label': label,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_tree_navigated', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return PiTreeNavigateResult.fromJson(data);
  }

  Future<List<PiCommand>> listCommands({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_list_commands',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_commands', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => PiCommand.fromJson(entry))
        .toList();
  }

  Future<Map<String, dynamic>> compact({
    String? customInstructions,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_compact',
      'requestId': requestId,
      if (customInstructions != null) 'customInstructions': customInstructions,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_compacted', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<bool> setAutoCompaction({
    required bool enabled,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_auto_compaction',
      'requestId': requestId,
      'enabled': enabled,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_auto_compaction_set',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  Future<String> exportHtml({String? outputPath, String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_export_html',
      'requestId': requestId,
      if (outputPath != null) 'outputPath': outputPath,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_export_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['path'] as String? ?? '';
  }

  Future<Map<String, dynamic>> getSettings({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_settings',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_settings', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<bool> setSettings({
    required Map<String, dynamic> settings,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_set_settings',
      'requestId': requestId,
      'settings': settings,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_settings_updated',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  Future<bool> respondToExtensionUi({
    required String id,
    String? projectPath,
    String? value,
    bool? confirmed,
    bool cancelled = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_extension_ui_response',
      'requestId': requestId,
      'id': id,
      if (value != null) 'value': value,
      if (confirmed != null) 'confirmed': confirmed,
      if (cancelled) 'cancelled': true,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_extension_ui_responded',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  Future<bool> disposeInstance({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_dispose_instance',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_instance_disposed',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }
}
