import 'dart:async';
import 'dart:developer' as developer;
import 'dart:math';

import 'package:broski/models/agent.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/codex/codex_plugin.dart';
import 'package:broski/models/command.dart';
import 'package:broski/models/device.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/file_binary_content.dart';
import 'package:broski/models/file_content.dart';
import 'package:broski/models/git.dart';
import 'package:broski/models/mcp.dart';
import 'package:broski/models/opencode_markdown_file.dart';
import 'package:broski/models/opencode_plugin_file.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/models/pi_durable/pi_durable_payloads.dart';
import 'package:broski/models/pi_durable/pi_durable_transcript.dart';
import 'package:broski/models/pi_subagent_invocation.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/provider.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/models/search_result.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/skill.dart';
import 'package:broski/models/subscription_usage.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/models/tool.dart';
import 'package:broski/models/transcript_page.dart';
import 'package:broski/models/vcs.dart';
import 'package:broski/models/worktree.dart';
import 'package:broski/services/bridge/runtime_replay_tracker.dart';
import 'package:broski/services/bridge/skill_mapping.dart';
import 'package:broski/services/websocket_service.dart';

part 'bridge/bridge_cc_chat.dart';
part 'bridge/bridge_cc_commands.dart';
part 'bridge/bridge_cc_config.dart';
part 'bridge/bridge_cc_custom_tools.dart';
part 'bridge/bridge_cc_hooks_mcp.dart';
part 'bridge/bridge_cc_memory.dart';
part 'bridge/bridge_cc_plugins.dart';
part 'bridge/bridge_cc_sessions.dart';
part 'bridge/bridge_cc_skills.dart';
part 'bridge/bridge_cc_subagents.dart';
part 'bridge/bridge_claude_code_updates.dart';
// ============================================================
// Existing part files (CC, CX, OC)
// ============================================================
part 'bridge/bridge_codex_core.dart';
part 'bridge/bridge_codex_features.dart';
part 'bridge/bridge_codex_fs.dart';
part 'bridge/bridge_codex_search.dart';
part 'bridge/bridge_codex_workspace.dart';
part 'bridge/bridge_codex_plugins.dart';
part 'bridge/bridge_codex_runtime.dart';
part 'bridge/bridge_codex_threads.dart';
part 'bridge/bridge_config.dart';
part 'bridge/bridge_files.dart';
part 'bridge/bridge_git.dart';
part 'bridge/bridge_mcp.dart';
part 'bridge/bridge_misc.dart';
// ============================================================
// New part files (extracted to reduce file size)
// ============================================================
part 'bridge/bridge_opencode_features.dart';
part 'bridge/bridge_opencode_sessions.dart';
part 'bridge/bridge_opencode_updates.dart';
part 'bridge/bridge_pty.dart';
part 'bridge/bridge_sessions_actions.dart';
part 'bridge/bridge_sessions_core.dart';
part 'bridge/bridge_sessions_lifecycle.dart';
part 'bridge/bridge_skills_universal.dart';
part 'bridge/bridge_worktrees.dart';
part 'bridge/bridge_pi_subagent.dart';
part 'bridge/bridge_pi_durable.dart';
part 'bridge/bridge_unified.dart';
part 'bridge/bridge_unified_children.dart';
part 'bridge/bridge_message_replay.dart';

class BridgeService {
  static const protocolVersion = '1.0.0';

  BridgeService(this._socket) {
    _dispatcherSub = _socket.messages.listen(_dispatchMessage);
  }

  final WebSocketService _socket;
  final _random = Random();
  int _requestCounter = 0;
  late final StreamSubscription<Map<String, dynamic>> _dispatcherSub;
  final Map<String, Completer<Map<String, dynamic>>> _pendingByRequestId = {};
  final Map<String, Map<String, dynamic>> _earlyResponsesByRequestId = {};
  final Map<String, int> _earlyResponseAtMs = {};

  // ============================================================
  // In-flight Request Deduplication
  // ============================================================
  final Map<String, Future<dynamic>> _inFlightRequests = {};
  final Set<String> _inFlightFireAndForget = {};

  Future<T> _deduplicatedRequest<T>(
    String key,
    Future<T> Function() operation,
  ) async {
    if (_inFlightRequests.containsKey(key)) {
      return await _inFlightRequests[key] as T;
    }
    final future = operation();
    _inFlightRequests[key] = future;
    try {
      return await future;
    } finally {
      _inFlightRequests.remove(key);
    }
  }

  bool _guardFireAndForget(
    String key, {
    Duration cooldown = const Duration(milliseconds: 500),
  }) {
    if (_inFlightFireAndForget.contains(key)) {
      developer.log(
        'Blocked duplicate fire-and-forget: $key',
        name: 'BridgeService',
      );
      return false;
    }
    _inFlightFireAndForget.add(key);
    Future.delayed(cooldown, () {
      _inFlightFireAndForget.remove(key);
    });
    return true;
  }

  // ============================================================
  // Request Timing
  // ============================================================
  static const int _slowRequestThresholdMs = 500;

  Future<T> _timedRequest<T>(String name, Future<T> Function() request) async {
    final stopwatch = Stopwatch()..start();
    try {
      return await request();
    } finally {
      stopwatch.stop();
      if (stopwatch.elapsedMilliseconds > _slowRequestThresholdMs) {
        developer.log(
          'Slow request: $name took ${stopwatch.elapsedMilliseconds}ms',
          name: 'BridgeService',
        );
      }
    }
  }

  // ============================================================
  // Core streams & auth
  // ============================================================

  Stream<Map<String, dynamic>> get messages => _socket.messages;

  // ============================================================
  // Internal dispatch & lifecycle
  // ============================================================

  String _generateRequestId() {
    _requestCounter++;
    return 'req_${_requestCounter}_${_random.nextInt(999999)}';
  }

  void _dispatchMessage(Map<String, dynamic> message) {
    final requestId = message['requestId'];
    if (requestId is! String || requestId.isEmpty) return;
    final waiter = _pendingByRequestId.remove(requestId);
    if (waiter != null && !waiter.isCompleted) {
      waiter.complete(message);
      return;
    }

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    _earlyResponsesByRequestId[requestId] = message;
    _earlyResponseAtMs[requestId] = nowMs;

    // Evict oldest entries when the cache is full instead of nuking everything.
    if (_earlyResponsesByRequestId.length > 64) {
      // Sort by arrival time, remove the oldest half.
      final entries = _earlyResponseAtMs.entries.toList()
        ..sort((a, b) => a.value.compareTo(b.value));
      final toRemove = entries.take(32);
      for (final entry in toRemove) {
        _earlyResponsesByRequestId.remove(entry.key);
        _earlyResponseAtMs.remove(entry.key);
      }
    }
  }

  void dispose() {
    _dispatcherSub.cancel();
    for (final entry in _pendingByRequestId.entries) {
      if (!entry.value.isCompleted) {
        entry.value.completeError(
          StateError('BridgeService disposed while waiting for response'),
        );
      }
    }
    _pendingByRequestId.clear();
    _earlyResponsesByRequestId.clear();
    _earlyResponseAtMs.clear();
  }

  // ============================================================
  // _waitFor — core response awaiter
  // ============================================================

  Future<Map<String, dynamic>> _waitFor(
    String type, {
    String? requestId,
    int timeoutSeconds = 10,
  }) {
    final timeout = Duration(seconds: timeoutSeconds);
    final cacheMaxAge = timeoutSeconds * 1000;

    if (requestId == null || requestId.isEmpty) {
      return _socket.messages
          .firstWhere((message) {
            final msgType = message['type'] as String?;
            return msgType == type || msgType == 'error';
          })
          .timeout(
            timeout,
            onTimeout: () =>
                throw TimeoutException('Bridge response timeout: $type'),
          )
          .then((message) {
            if (message['type'] == 'error') {
              final errorMsg = message['message'] as String? ?? 'Unknown error';
              throw Exception('Bridge error: $errorMsg');
            }
            return message;
          });
    }

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final cached = _earlyResponsesByRequestId.remove(requestId);
    final cachedAt = _earlyResponseAtMs.remove(requestId);
    if (cached != null && cachedAt != null && nowMs - cachedAt <= cacheMaxAge) {
      final msgType = cached['type'] as String?;
      if (msgType == 'error') {
        final errorMsg = cached['message'] as String? ?? 'Unknown error';
        throw Exception('Bridge error: $errorMsg');
      }
      if (msgType != type) {
        throw Exception(
          'Bridge response mismatch: expected=$type got=$msgType',
        );
      }
      return Future.value(cached);
    }

    if (_pendingByRequestId.containsKey(requestId)) {
      return _pendingByRequestId[requestId]!.future;
    }

    final completer = Completer<Map<String, dynamic>>();
    _pendingByRequestId[requestId] = completer;

    final timer = Timer(timeout, () {
      _pendingByRequestId.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(
          TimeoutException('Bridge response timeout: $type'),
        );
      }
    });

    return completer.future.then((message) {
      timer.cancel();

      final msgType = message['type'] as String?;
      if (msgType == 'error') {
        final errorMsg = message['message'] as String? ?? 'Unknown error';
        throw Exception('Bridge error: $errorMsg');
      }

      if (msgType != type) {
        throw Exception(
          'Bridge response mismatch: expected=$type got=$msgType',
        );
      }

      return message;
    });
  }
}
