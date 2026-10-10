import 'dart:async';

import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/services/websocket_service.dart';

export 'bridge/bridge_pi_tools.dart';
export 'bridge/bridge_pi_transcript.dart';

/// Raised for Pi requests that were still in flight when the socket dropped.
class PiBridgeDisconnectedException implements Exception {
  PiBridgeDisconnectedException([this.message = 'Connection lost']);

  final String message;

  @override
  String toString() => message;
}

class PiBridgeService {
  PiBridgeService(this._socket) {
    _dispatcherSub = _socket.messages.listen(_dispatchMessage);
    _statusSub = _socket.statusStream.listen(_handleStatus);
  }

  final WebSocketService _socket;
  late final StreamSubscription<Map<String, dynamic>> _dispatcherSub;
  late final StreamSubscription<ConnectionStatus> _statusSub;

  int _requestCounter = 0;
  final Map<String, Completer<Map<String, dynamic>>> _pendingByRequestId = {};

  static const _requestIdPrefix = 'pi_req_';

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

  /// The bridge does not re-send a reply after a reconnect, so every request
  /// still waiting when the socket drops is unanswerable and has to fail now
  /// instead of holding the caller (and the composer) until its timeout.
  void _handleStatus(ConnectionStatus status) {
    if (status == ConnectionStatus.connected) return;
    final pending = _pendingByRequestId.values.toList();
    _pendingByRequestId.clear();
    for (final completer in pending) {
      if (completer.isCompleted) continue;
      completer.completeError(PiBridgeDisconnectedException());
    }
  }

  void dispose() {
    _dispatcherSub.cancel();
    _statusSub.cancel();
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

  Future<List<ProjectSummary>> listProjects() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'pi_list_projects', 'requestId': requestId});

    final response = await _waitFor('pi_projects', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((entry) => ProjectSummary.fromJson(entry))
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

  /// Read messages directly from a Pi session JSONL file without
  /// needing a live AgentSession instance. Much faster than [getMessages]
  /// because it skips model resolution, extension loading, etc.
  Future<List<Map<String, dynamic>>> readSessionMessages({
    String? sessionPath,
    String? sessionId,
    int? limit,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_read_session_messages',
      'requestId': requestId,
      if (sessionPath != null) 'sessionPath': sessionPath,
      if (sessionId != null) 'sessionId': sessionId,
      if (limit != null) 'limit': limit,
    });

    final response = await _waitFor(
      'pi_session_messages',
      requestId: requestId,
    );
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

  Future<List<Map<String, dynamic>>> getModifiedFiles({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_modified_files',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    try {
      final response = await _waitFor(
        'pi_modified_files',
        requestId: requestId,
      );
      final data = response['data'] as List<dynamic>? ?? const [];
      return data.whereType<Map<String, dynamic>>().toList(growable: false);
    } catch (_) {
      return const [];
    }
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

  Future<String> exportJsonl({String? outputPath, String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_export_jsonl',
      'requestId': requestId,
      if (outputPath != null) 'outputPath': outputPath,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_export_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['path'] as String? ?? '';
  }

  Future<String?> getLastAssistantText({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_last_assistant_text',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor(
      'pi_last_assistant_text',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['text'] as String?;
  }

  Future<String> getSystemPrompt({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pi_get_system_prompt',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });

    final response = await _waitFor('pi_system_prompt', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['systemPrompt'] as String? ?? '';
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
