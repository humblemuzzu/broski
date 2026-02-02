import 'dart:async';
import 'dart:developer' as developer;
import 'dart:math';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/command.dart';
import '../models/device.dart';
import '../models/file_attachment.dart';
import '../models/file_binary_content.dart';
import '../models/file_content.dart';
import '../models/mcp.dart';
import '../models/opencode_plugin_file.dart';
import '../models/opencode_markdown_file.dart';
import '../models/permission_rule.dart';
import '../models/skill.dart';
import '../models/project.dart';
import '../models/provider.dart';
import '../models/search_result.dart';
import '../models/session.dart';
import '../models/todo.dart';
import '../models/subscription_usage.dart';
import '../models/tool.dart';
import '../models/vcs.dart';
import '../models/worktree.dart';
import 'websocket_service.dart';

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
  // Tracks in-flight async requests to prevent duplicate API calls.
  // When the same operation is requested while one is already pending,
  // the caller receives the same Future instead of creating a duplicate.
  final Map<String, Future<dynamic>> _inFlightRequests = {};

  // Tracks in-flight fire-and-forget operations (void methods).
  // These don't return a value, so we just track whether they're active.
  final Set<String> _inFlightFireAndForget = {};

  // ============================================================
  // Generic Deduplication Wrapper
  // ============================================================
  // Use this for all write/update operations that return a value.
  // If the same operation (by key) is already in-flight, returns the
  // existing Future instead of creating a duplicate request.
  Future<T> _deduplicatedRequest<T>(
    String key,
    Future<T> Function() operation,
  ) async {
    // If same request is already in-flight, return that future
    if (_inFlightRequests.containsKey(key)) {
      return await _inFlightRequests[key] as T;
    }

    // Create and track the request
    final future = operation();
    _inFlightRequests[key] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(key);
    }
  }

  // ============================================================
  // Fire-and-Forget Guard
  // ============================================================
  // Use this for void methods that don't wait for a response.
  // Prevents duplicate sends during lag by tracking active operations.
  // Returns true if the operation should proceed, false if duplicate.
  bool _guardFireAndForget(
    String key, {
    Duration cooldown = const Duration(milliseconds: 500),
  }) {
    if (_inFlightFireAndForget.contains(key)) {
      developer.log(
        'Blocked duplicate fire-and-forget: $key',
        name: 'BridgeService',
      );
      return false; // Duplicate - don't proceed
    }

    _inFlightFireAndForget.add(key);

    // Auto-remove after cooldown (since we don't have a response to wait for)
    Future.delayed(cooldown, () {
      _inFlightFireAndForget.remove(key);
    });

    return true; // Proceed with operation
  }

  // ============================================================
  // Request Timing (logs slow requests > 500ms)
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

  Stream<Map<String, dynamic>> get messages => _socket.messages;

  void _dispatchMessage(Map<String, dynamic> message) {
    final requestId = message['requestId'];
    if (requestId is! String || requestId.isEmpty) return;
    final waiter = _pendingByRequestId.remove(requestId);
    if (waiter != null && !waiter.isCompleted) {
      waiter.complete(message);
      return;
    }

    // Response arrived before the caller registered its waiter. Keep a short
    // lived cache to avoid rare "missed response" timeouts.
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    _earlyResponsesByRequestId[requestId] = message;
    _earlyResponseAtMs[requestId] = nowMs;

    // Best-effort cleanup to keep memory bounded.
    if (_earlyResponsesByRequestId.length > 64) {
      _earlyResponsesByRequestId.clear();
      _earlyResponseAtMs.clear();
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

  Stream<Map<String, dynamic>> get sdkEvents =>
      _socket.messages.expand((message) {
        final type = message['type'];
        if (type == 'sdk_event') {
          final data = message['data'];
          if (data is Map<String, dynamic>) return [data];
          return const Iterable<Map<String, dynamic>>.empty();
        }
        if (type == 'sdk_event_batch') {
          final data = message['data'];
          if (data is List) {
            return data.whereType<Map<String, dynamic>>();
          }
          return const Iterable<Map<String, dynamic>>.empty();
        }
        return const Iterable<Map<String, dynamic>>.empty();
      });

  String _generateRequestId() {
    _requestCounter++;
    return 'req_${_requestCounter}_${_random.nextInt(999999)}';
  }

  Future<List<ProjectSummary>> listProjects() async {
    const dedupeKey = 'list_projects';

    // Check if request is already in-flight
    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<ProjectSummary>;
    }

    // Create the request future
    final future = _listProjectsInternal();
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<ProjectSummary>> _listProjectsInternal() async {
    return _timedRequest('list_projects', () async {
      final requestId = _generateRequestId();
      _socket.send({'type': 'list_projects', 'requestId': requestId});
      final response = await _waitFor('projects', requestId: requestId);
      final data = response['data'] as List<dynamic>? ?? [];
      return data
          .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
          .toList();
    });
  }

  Future<List<SessionSummary>> listSessions({String? projectPath}) async {
    final dedupeKey = 'list_sessions:${projectPath ?? 'all'}';

    // Check if request is already in-flight
    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<SessionSummary>;
    }

    // Create the request future
    final future = _listSessionsInternal(projectPath: projectPath);
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<SessionSummary>> _listSessionsInternal({
    String? projectPath,
  }) async {
    return _timedRequest('list_sessions', () async {
      final requestId = _generateRequestId();
      _socket.send({
        'type': 'list_sessions',
        'requestId': requestId,
        if (projectPath != null) 'projectPath': projectPath,
      });
      final response = await _waitFor('sessions', requestId: requestId);
      final data = response['data'] as List<dynamic>? ?? [];
      return data
          .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
          .toList();
    });
  }

  Future<Map<String, dynamic>> listProviders() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_providers', 'requestId': requestId});
    final response = await _waitFor('providers', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> getConfig({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_config',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setConfig(
    Map<String, dynamic> config, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_config',
      'requestId': requestId,
      'config': config,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setModel(
    String model, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_model',
      'model': model,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<bool> restartOpenCode() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'restart_opencode', 'requestId': requestId});
    final response = await _waitFor('opencode_restarted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  void setView({String? projectPath, String? sessionId, String? agent}) {
    _socket.send({
      'type': 'set_view',
      if (projectPath != null) 'projectPath': projectPath,
      if (sessionId != null) 'sessionId': sessionId,
      if (agent != null) 'agent': agent,
    });
  }

  /// Create a new session (protected against duplicate calls)
  Future<SessionSummary> createSession({
    String? projectPath,
    String? title,
    PermissionRuleset? permission,
  }) {
    // Dedupe by project path - if already creating a session for this project,
    // return the same future instead of creating another session
    final permKey = permission == null
        ? 'none'
        : permission
              .map((r) => '${r.permission}:${r.pattern}:${r.action.name}')
              .join('|');
    final dedupeKey = 'create_session:${projectPath ?? 'global'}:$permKey';
    return _deduplicatedRequest(
      dedupeKey,
      () => _createSessionInternal(
        projectPath: projectPath,
        title: title,
        permission: permission,
      ),
    );
  }

  Future<SessionSummary> _createSessionInternal({
    String? projectPath,
    String? title,
    PermissionRuleset? permission,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_session',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (title != null) 'title': title,
      if (permission != null)
        'permission': permission.map((r) => r.toJson()).toList(),
    });
    final response = await _waitFor('session_created', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<SessionSummary> getSession(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<List<dynamic>> getSessionMessages(
    String sessionId, {
    String? projectPath,
    int? limit,
  }) async {
    final dedupeKey =
        'get_session_messages:$sessionId:${projectPath ?? 'null'}:${limit ?? 'all'}';

    // Check if request is already in-flight
    if (_inFlightRequests.containsKey(dedupeKey)) {
      return await _inFlightRequests[dedupeKey] as List<dynamic>;
    }

    // Create the request future
    final future = _getSessionMessagesInternal(
      sessionId,
      projectPath: projectPath,
      limit: limit,
    );
    _inFlightRequests[dedupeKey] = future;

    try {
      return await future;
    } finally {
      _inFlightRequests.remove(dedupeKey);
    }
  }

  Future<List<dynamic>> _getSessionMessagesInternal(
    String sessionId, {
    String? projectPath,
    int? limit,
  }) async {
    return _timedRequest('get_session_messages', () async {
      final requestId = _generateRequestId();
      _socket.send({
        'type': 'get_session_messages',
        'sessionId': sessionId,
        'requestId': requestId,
        if (projectPath != null) 'projectPath': projectPath,
        if (limit != null) 'limit': limit,
      });
      final response = await _waitFor('session_messages', requestId: requestId);
      return response['data'] as List<dynamic>? ?? [];
    });
  }

  /// Send a chat message (protected against duplicate sends during lag)
  void sendChat({
    required String sessionId,
    required String content,
    String? messageId,
    String? projectPath,
    String? providerID,
    String? modelID,
    String? agent,
    List<FileAttachment>? fileAttachments,
    String? variant,
  }) {
    // Guard against duplicate sends - use content hash to allow different messages
    // but prevent the exact same message from being sent twice
    final contentHash = content.hashCode;
    final guardKey = 'chat:$sessionId:$contentHash';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return; // Duplicate detected, skip
    }

    _socket.send({
      'type': 'chat',
      'sessionId': sessionId,
      'content': content,
      if (messageId != null) 'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
      if (providerID != null && modelID != null)
        'model': {'providerID': providerID, 'modelID': modelID},
      if (agent != null) 'agent': agent,
      if (fileAttachments != null && fileAttachments.isNotEmpty)
        'fileAttachments': fileAttachments.map((f) => f.toJson()).toList(),
      if (variant != null && variant.isNotEmpty) 'variant': variant,
    });
  }

  void abortSession(String sessionId, {String? projectPath}) {
    _socket.send({
      'type': 'abort',
      'sessionId': sessionId,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  Future<List<dynamic>> getSessionDiff(
    String sessionId, {
    String? projectPath,
    String? messageId,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'diff',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (messageId != null) 'messageId': messageId,
    });
    final response = await _waitFor('diff', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
  }

  Future<List<dynamic>> browse(String path, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'browse',
      'path': path,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('browse_result', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['items'] as List<dynamic>? ?? [];
  }

  /// Respond to a permission request (protected against duplicate responses)
  ///
  /// [permissionId] - The request ID (requestID in SDK v1.1.1+)
  /// [response] - "once", "always", or "reject"
  /// [message] - Optional feedback message (useful when rejecting)
  void respondToPermission({
    required String sessionId,
    required String permissionId,
    required String response,
    String? message,
    String? projectPath,
  }) {
    // Guard against duplicate permission responses - each permission should only
    // be responded to once
    final guardKey = 'permission:$permissionId';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 5))) {
      return; // Already responded, skip
    }

    _socket.send({
      'type': 'permission_response',
      'sessionId': sessionId,
      'permissionId': permissionId,
      'response': response,
      if (message != null && message.isNotEmpty) 'message': message,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  // ============================================================
  // OpenCode - Question Tool
  // ============================================================

  Future<bool> ocReplyToQuestion({
    required String requestId,
    required List<List<String>> answers,
    String? projectPath,
  }) async {
    final wireRequestId = _generateRequestId();
    _socket.send({
      'type': 'oc_question_reply',
      'requestId': wireRequestId,
      'questionId': requestId,
      'answers': answers,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_question_replied',
      requestId: wireRequestId,
    );
    return response['data'] == true;
  }

  Future<bool> ocRejectQuestion({
    required String requestId,
    String? projectPath,
  }) async {
    final wireRequestId = _generateRequestId();
    _socket.send({
      'type': 'oc_question_reject',
      'requestId': wireRequestId,
      'questionId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_question_rejected',
      requestId: wireRequestId,
    );
    return response['data'] == true;
  }

  Future<List<dynamic>> getLspStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_lsp_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('lsp_status', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
  }

  Future<Map<String, dynamic>> getSessionContext(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session_context',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_context', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  // ============================================================
  // Feature 1: Todo/Plan Management
  // ============================================================

  /// Get todos/plan items for a session
  Future<List<Todo>> getTodos(String sessionId, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_todos',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('todos', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Todo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 2: Slash Commands
  // ============================================================

  /// List available slash commands
  Future<List<SlashCommand>> listCommands({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_commands',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('commands', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SlashCommand.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // OpenCode - Skills (filesystem-backed)
  // ============================================================

  Future<List<Skill>> ocListSkills({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_skills',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(
          (m) => Skill(
            backend: AgentType.opencode,
            name: m['name'] as String? ?? '',
            description: m['description'] as String?,
            source: SkillSource.fromWire(m['source'] as String?),
            path: m['path'] as String? ?? '',
          ),
        )
        .toList();
  }

  Future<Skill?> ocGetSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.opencode,
      name: data['name'] as String? ?? name,
      description: null,
      source: SkillSource.fromWire(data['source'] as String?),
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill_saved', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill_deleted', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<OpenCodePluginFile>> ocListPluginFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_plugin_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_plugin_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodePluginFile.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>?> ocGetPluginFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_plugin_file', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }

  Future<bool> ocSavePluginFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_plugin_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeletePluginFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_plugin_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  // ============================================================
  // OpenCode - Custom Commands / Agents (filesystem-backed)
  // ============================================================

  Future<List<OpenCodeMarkdownFile>> ocListCommandFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_command_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_command_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodeMarkdownFile.fromJson)
        .toList();
  }

  Future<({String path, String content})> ocGetCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_command_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return (
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveCommandFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_command_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_command_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<OpenCodeMarkdownFile>> ocListAgentFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_agent_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_agent_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodeMarkdownFile.fromJson)
        .toList();
  }

  Future<({String path, String content})> ocGetAgentFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_agent_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return (
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveAgentFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_agent_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteAgentFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_agent_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  /// Execute a slash command (protected against duplicate executions)
  void executeCommand({
    required String sessionId,
    required String command,
    required String arguments,
    String? projectPath,
    String? agent,
    String? model,
  }) {
    // Guard against duplicate command executions
    final guardKey = 'command:$sessionId:$command:${arguments.hashCode}';

    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return; // Duplicate detected, skip
    }

    _socket.send({
      'type': 'execute_command',
      'sessionId': sessionId,
      'command': command,
      'arguments': arguments,
      if (projectPath != null) 'projectPath': projectPath,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
    });
  }

  // ============================================================
  // Feature 3: Agent Switching
  // ============================================================

  /// List available agents (build, plan, etc.)
  Future<List<Agent>> listAgents({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_agents',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('agents', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Agent.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 4: Session Delete
  // ============================================================

  /// Delete a session (protected against duplicate deletions)
  Future<bool> deleteSession(String sessionId, {String? projectPath}) {
    final dedupeKey = 'delete_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _deleteSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<bool> _deleteSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Feature 5: Session Update (Rename)
  // ============================================================

  /// Update session (rename title, archive) - protected against duplicate updates
  Future<SessionSummary> updateSession(
    String sessionId, {
    String? title,
    bool? archived,
    String? projectPath,
  }) {
    final dedupeKey = 'update_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _updateSessionInternal(
        sessionId,
        title: title,
        archived: archived,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _updateSessionInternal(
    String sessionId, {
    String? title,
    bool? archived,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'update_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (title != null) 'title': title,
      if (archived != null) 'archived': archived,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_updated', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Feature 6: Session Fork
  // ============================================================

  /// Fork a session to create a branch from a specific point
  /// (protected against duplicate forks)
  ///
  /// [messageId] - Optional message ID to fork from; if omitted, forks at end
  Future<SessionSummary> forkSession(
    String sessionId, {
    String? messageId,
    String? projectPath,
  }) {
    // Dedupe by session + message - same fork request returns same result
    final dedupeKey = 'fork_session:$sessionId:${messageId ?? 'end'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _forkSessionInternal(
        sessionId,
        messageId: messageId,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _forkSessionInternal(
    String sessionId, {
    String? messageId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'fork_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (messageId != null) 'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_forked', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Feature 7: Message Revert (Undo)
  // ============================================================

  /// Revert a message (undo file changes made by the AI)
  /// (protected against duplicate reverts)
  ///
  /// [partId] - Optional part ID to revert a specific tool call
  Future<SessionSummary> revertMessage(
    String sessionId, {
    required String messageId,
    String? partId,
    String? projectPath,
  }) {
    final dedupeKey = 'revert:$sessionId:$messageId:${partId ?? 'all'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _revertMessageInternal(
        sessionId,
        messageId: messageId,
        partId: partId,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _revertMessageInternal(
    String sessionId, {
    required String messageId,
    String? partId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'revert_message',
      'sessionId': sessionId,
      'messageId': messageId,
      'requestId': requestId,
      if (partId != null) 'partId': partId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('message_reverted', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  /// Unrevert a session (restore reverted messages)
  /// (protected against duplicate unreverts)
  Future<SessionSummary> unrevertSession(
    String sessionId, {
    String? projectPath,
  }) {
    final dedupeKey = 'unrevert:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _unrevertSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _unrevertSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unrevert_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_unreverted', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Feature 8: Session Share
  // ============================================================

  /// Share a session publicly (get shareable URL)
  /// (protected against duplicate share requests)
  Future<SessionSummary> shareSession(String sessionId, {String? projectPath}) {
    final dedupeKey = 'share:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _shareSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _shareSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'share_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_shared', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  /// Unshare a session (remove public URL)
  /// (protected against duplicate unshare requests)
  Future<SessionSummary> unshareSession(
    String sessionId, {
    String? projectPath,
  }) {
    final dedupeKey = 'unshare:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _unshareSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _unshareSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unshare_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_unshared', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Feature 9: Session Summarize (Compact)
  // ============================================================

  /// Summarize/compact a session to free up context window
  /// (protected against duplicate summarization - expensive operation!)
  ///
  /// This will summarize old messages and reduce token usage.
  /// Returns true if summarization was successful.
  Future<bool> summarizeSession(
    String sessionId, {
    required String providerID,
    required String modelID,
    String? projectPath,
  }) {
    // Important: Summarization is expensive (uses AI tokens), so we definitely
    // want to prevent duplicate calls
    final dedupeKey = 'summarize:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _summarizeSessionInternal(
        sessionId,
        providerID: providerID,
        modelID: modelID,
        projectPath: projectPath,
      ),
    );
  }

  Future<bool> _summarizeSessionInternal(
    String sessionId, {
    required String providerID,
    required String modelID,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'summarize_session',
      'sessionId': sessionId,
      'providerID': providerID,
      'modelID': modelID,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_summarized', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Feature 10: Git/VCS Information
  // ============================================================

  /// Get VCS (git) information for the project
  Future<VcsInfo> getVcsInfo({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_vcs',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('vcs', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return VcsInfo.fromJson(data);
  }

  // ============================================================
  // Feature 11: File Content Read
  // ============================================================

  Future<FileContent> readFile(String path, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'read_file',
      'path': path,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('file_content', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return FileContent.fromJson(data);
  }

  Future<FileBinaryResult> readFileBinary(
    String path, {
    int maxSizeMb = 10,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'read_file_binary',
      'path': path,
      'requestId': requestId,
      'maxSizeMb': maxSizeMb,
    });

    final response = await _socket.messages
        .firstWhere((message) {
          if (message['requestId'] != requestId) return false;
          final type = message['type'];
          return type == 'file_binary' ||
              type == 'file_too_large' ||
              type == 'error';
        })
        .timeout(
          const Duration(seconds: 30),
          onTimeout: () => throw TimeoutException('Binary file read timeout'),
        );

    final type = response['type'];
    if (type == 'file_too_large') {
      final payload = response['data'];
      if (payload is Map<String, dynamic>) {
        return FileBinaryResult.tooLarge(FileTooLargeError.fromJson(payload));
      }
      // Backward compatibility (older bridge used top-level fields)
      return FileBinaryResult.tooLarge(FileTooLargeError.fromJson(response));
    }
    if (type == 'error') {
      throw Exception(response['message'] ?? 'Failed to read file');
    }

    final data = response['data'] as Map<String, dynamic>? ?? {};
    return FileBinaryResult.success(FileBinaryContent.fromJson(data));
  }

  // ============================================================
  // Feature 12: File Search
  // ============================================================

  Future<List<String>> findFiles(String query, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_files',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('files_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((item) => item.toString()).toList();
  }

  Future<List<String>> searchFilesAndDirs(
    String query, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'search_files_and_dirs',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'files_and_dirs_found',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((item) => item.toString()).toList();
  }

  Future<List<TextSearchResult>> findText(
    String pattern, {
    String? include,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_text',
      'pattern': pattern,
      'requestId': requestId,
      if (include != null) 'include': include,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('text_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => TextSearchResult.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Find symbols in codebase (LSP search)
  Future<List<SymbolResult>> findSymbols(
    String query, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'find_symbols',
      'query': query,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('symbols_found', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SymbolResult.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 13: Session Status
  // ============================================================

  /// Get status of all sessions (idle/busy/retry)
  Future<Map<String, SessionStatus>> getSessionStatus({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_session_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, SessionStatus>{};
    for (final entry in data.entries) {
      result[entry.key] = SessionStatus.fromJson(
        entry.value as Map<String, dynamic>,
      );
    }
    return result;
  }

  // ============================================================
  // Feature 14: PTY Terminal Sessions
  // ============================================================

  /// List all PTY sessions
  Future<List<Map<String, dynamic>>> listPty({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_pty',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pty_list', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.cast<Map<String, dynamic>>();
  }

  /// Create a new PTY session (protected against duplicate creates)
  Future<Map<String, dynamic>?> createPty({
    String? command,
    List<String>? args,
    String? cwd,
    String? title,
    String? projectPath,
  }) {
    // Dedupe by command + cwd to prevent duplicate terminals
    final dedupeKey = 'create_pty:${command ?? 'default'}:${cwd ?? 'none'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _createPtyInternal(
        command: command,
        args: args,
        cwd: cwd,
        title: title,
        projectPath: projectPath,
      ),
    );
  }

  Future<Map<String, dynamic>?> _createPtyInternal({
    String? command,
    List<String>? args,
    String? cwd,
    String? title,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    final message = {
      'type': 'create_pty',
      'requestId': requestId,
      if (command != null) 'command': command,
      if (args != null) 'args': args,
      if (cwd != null) 'cwd': cwd,
      if (title != null) 'title': title,
      if (projectPath != null) 'projectPath': projectPath,
    };
    developer.log('[PTY] Sending create_pty: $message', name: 'BridgeService');
    _socket.send(message);
    developer.log(
      '[PTY] Waiting for pty_created with requestId: $requestId',
      name: 'BridgeService',
    );
    final response = await _waitFor('pty_created', requestId: requestId);
    developer.log('[PTY] Got response: $response', name: 'BridgeService');
    return response['data'] as Map<String, dynamic>?;
  }

  /// Get a PTY session by ID
  Future<Map<String, dynamic>?> getPty(
    String ptyId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_pty',
      'ptyId': ptyId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pty', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }

  /// Update a PTY session (title, size) - protected against race conditions
  Future<Map<String, dynamic>?> updatePty(
    String ptyId, {
    String? title,
    int? rows,
    int? cols,
    String? projectPath,
  }) {
    final dedupeKey = 'update_pty:$ptyId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _updatePtyInternal(
        ptyId,
        title: title,
        rows: rows,
        cols: cols,
        projectPath: projectPath,
      ),
    );
  }

  Future<Map<String, dynamic>?> _updatePtyInternal(
    String ptyId, {
    String? title,
    int? rows,
    int? cols,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'update_pty',
      'ptyId': ptyId,
      'requestId': requestId,
      if (title != null) 'title': title,
      if (rows != null) 'rows': rows,
      if (cols != null) 'cols': cols,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pty_updated', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }

  /// Delete a PTY session (protected against duplicate deletions)
  Future<bool> deletePty(String ptyId, {String? projectPath}) {
    final dedupeKey = 'delete_pty:$ptyId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _deletePtyInternal(ptyId, projectPath: projectPath),
    );
  }

  Future<bool> _deletePtyInternal(String ptyId, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_pty',
      'ptyId': ptyId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pty_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Feature 14b: PTY Interactive I/O
  // ============================================================

  Future<bool> connectPty(String ptyId, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'pty_connect',
      'ptyId': ptyId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    try {
      await _waitFor('pty_connected', requestId: requestId);
      return true;
    } catch (_) {
      return false;
    }
  }

  void sendPtyInput(String ptyId, String data) {
    _socket.send({'type': 'pty_input', 'ptyId': ptyId, 'data': data});
  }

  void disconnectPty(String ptyId) {
    _socket.send({'type': 'pty_disconnect', 'ptyId': ptyId});
  }

  void resizePty(String ptyId, int rows, int cols, {String? projectPath}) {
    _socket.send({
      'type': 'pty_resize',
      'ptyId': ptyId,
      'rows': rows,
      'cols': cols,
      if (projectPath != null) 'projectPath': projectPath,
    });
  }

  Stream<String> get ptyOutput => _socket.messages
      .where((m) => m['type'] == 'pty_output')
      .map((m) => m['data'] as String? ?? '');

  Stream<Map<String, dynamic>> get ptyEvents => _socket.messages.where(
    (m) =>
        m['type'] == 'pty_output' ||
        m['type'] == 'pty_exit' ||
        m['type'] == 'pty_error' ||
        m['type'] == 'pty_health',
  );

  // ============================================================
  // Feature 15: MCP Server Management
  // ============================================================

  /// Get MCP server status
  Future<Map<String, McpServerStatus>> getMcpStatus({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_mcp_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, McpServerStatus>{};
    for (final entry in data.entries) {
      result[entry.key] = McpServerStatus.fromJson(
        entry.value as Map<String, dynamic>,
      );
    }
    return result;
  }

  /// Connect to an MCP server (protected against duplicate connects)
  Future<bool> connectMcp(String name, {String? projectPath}) {
    final dedupeKey = 'connect_mcp:$name';
    return _deduplicatedRequest(
      dedupeKey,
      () => _connectMcpInternal(name, projectPath: projectPath),
    );
  }

  Future<bool> _connectMcpInternal(String name, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'connect_mcp',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_connected', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Disconnect from an MCP server (protected against duplicate disconnects)
  Future<bool> disconnectMcp(String name, {String? projectPath}) {
    final dedupeKey = 'disconnect_mcp:$name';
    return _deduplicatedRequest(
      dedupeKey,
      () => _disconnectMcpInternal(name, projectPath: projectPath),
    );
  }

  Future<bool> _disconnectMcpInternal(
    String name, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'disconnect_mcp',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_disconnected', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Get MCP resources from all connected servers (SDK v1.1.1+)
  Future<Map<String, McpResource>> getMcpResources({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_mcp_resources',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_resources', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, McpResource>{};
    for (final entry in data.entries) {
      result[entry.key] = McpResource.fromJson(
        entry.value as Map<String, dynamic>,
      );
    }
    return result;
  }

  // ============================================================
  // Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
  // ============================================================

  /// List all worktrees for a project
  Future<List<Worktree>> listWorktrees({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_worktrees',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktrees', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => Worktree.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Create a new worktree
  Future<Worktree?> createWorktree({
    String? name,
    String? startCommand,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_worktree',
      'requestId': requestId,
      if (name != null) 'name': name,
      if (startCommand != null) 'startCommand': startCommand,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktree_created', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return Worktree.fromJson(data);
  }

  /// Delete a worktree
  Future<bool> deleteWorktree(String name, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_worktree',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('worktree_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Feature 16: Full Provider Management
  // ============================================================

  /// List all available providers with their models
  Future<ProviderInfo> listAllProviders({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_all_providers',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('all_providers', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ProviderInfo.fromJson(data);
  }

  /// Get authentication methods for each provider
  Future<Map<String, List<ProviderAuthMethod>>> getProviderAuth({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_provider_auth',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('provider_auth', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, List<ProviderAuthMethod>>{};
    for (final entry in data.entries) {
      final methods = (entry.value as List<dynamic>? ?? [])
          .map((m) => ProviderAuthMethod.fromJson(m as Map<String, dynamic>))
          .toList();
      result[entry.key] = methods;
    }
    return result;
  }

  // ============================================================
  // Feature 17: Tool List
  // ============================================================

  /// Get list of tool IDs
  Future<List<String>> listToolIds({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_tool_ids',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('tool_ids', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((t) => t.toString()).toList();
  }

  /// Get tools with details for a specific provider/model
  Future<List<ToolInfo>> listTools({
    required String provider,
    required String model,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_tools',
      'provider': provider,
      'model': model,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('tools', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((t) => ToolInfo.fromJson(t as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 18: File Status (Git)
  // ============================================================

  /// Get git status of files in the project
  Future<List<FileStatusInfo>> getFileStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_file_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('file_status', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((f) => FileStatusInfo.fromJson(f as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 19: Formatter Status
  // ============================================================

  /// Get status of formatters
  Future<List<FormatterInfo>> getFormatterStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_formatter_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('formatter_status', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((f) => FormatterInfo.fromJson(f as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Feature 20: Session Init (Create AGENTS.md)
  // ============================================================

  /// Initialize a session (create AGENTS.md)
  /// (protected against duplicate initialization)
  ///
  /// This analyzes the project and generates an AGENTS.md file
  /// with project-specific instructions for the AI.
  Future<bool> initSession({
    required String sessionId,
    required String providerID,
    required String modelID,
    required String messageID,
    String? projectPath,
  }) {
    final dedupeKey = 'init_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _initSessionInternal(
        sessionId: sessionId,
        providerID: providerID,
        modelID: modelID,
        messageID: messageID,
        projectPath: projectPath,
      ),
    );
  }

  Future<bool> _initSessionInternal({
    required String sessionId,
    required String providerID,
    required String modelID,
    required String messageID,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'init_session',
      'sessionId': sessionId,
      'providerID': providerID,
      'modelID': modelID,
      'messageID': messageID,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'session_initialized',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Multi-Device Support
  // ============================================================

  void registerDevice({
    required String deviceId,
    required String deviceName,
    required String platform,
  }) {
    _socket.send({
      'type': 'register_device',
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'protocolVersion': BridgeService.protocolVersion,
    });
  }

  Future<List<Map<String, dynamic>>> listPendingPermissions({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_pending_permissions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'pending_permissions',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<List<Map<String, dynamic>>> listPendingQuestions({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_pending_questions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pending_questions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<List<DeviceInfo>> listDevices() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_devices', 'requestId': requestId});
    final response = await _waitFor('devices', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => DeviceInfo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  void disconnectDevice(String deviceId) {
    _socket.send({'type': 'disconnect_device', 'deviceId': deviceId});
  }

  Future<bool> disposeInstance({String? projectPath}) {
    final dedupeKey = 'dispose_instance:${projectPath ?? 'current'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _disposeInstanceInternal(projectPath: projectPath),
    );
  }

  Future<bool> _disposeInstanceInternal({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'dispose_instance',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('instance_disposed', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Agent Type Management (OpenCode vs Claude Code)
  // ============================================================

  Future<AgentsStatus> getAgentsStatus() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_agents_status', 'requestId': requestId});
    final response = await _waitFor('agents_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return AgentsStatus.fromJson(data);
  }

  void setAgent(AgentType agentType) {
    _socket.send({'type': 'set_agent', 'agent': agentType.wireValue});
  }

  // ============================================================
  // Claude Code - Sessions
  // ============================================================

  Future<List<ProjectSummary>> ccListProjects() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_list_projects', 'requestId': requestId});
    final response = await _waitFor('cc_projects', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<ClaudeCodeSession>> ccListSessions({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_sessions',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeSession.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<ClaudeCodeSession?> ccGetSession(
    String sessionId, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor('cc_session', requestId: requestId);
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> ccGetSessionMessages(
    String sessionId, {
    String? cwd,
    int? limit,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_session_messages',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (limit != null) 'limit': limit,
    });
    final response = await _waitFor(
      'cc_session_messages',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<bool> ccDeleteSession(String sessionId, {String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_session_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<ClaudeCodeSession?> ccForkSession(
    String sessionId, {
    String? messageId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_fork_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (messageId != null) 'messageId': messageId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_forked',
        requestId: requestId,
      );
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<ClaudeCodeSession?> ccRenameSession(
    String sessionId,
    String name, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_rename_session',
      'sessionId': sessionId,
      'name': name,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_renamed',
        requestId: requestId,
      );
      final data = response['data'] as Map<String, dynamic>?;
      if (data == null) return null;
      return ClaudeCodeSession.fromJson(data);
    } catch (_) {
      return null;
    }
  }

  Future<bool> ccBackgroundSession(String sessionId, {String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_background_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    try {
      final response = await _waitFor(
        'cc_session_backgrounded',
        requestId: requestId,
      );
      return response['data'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Rewinds files to a previous checkpoint created during a Claude Code session.
  /// This undoes file changes made by Write/Edit/NotebookEdit tools.
  /// Returns true if successful, false otherwise.
  Future<bool> ccRewindCheckpoint({
    required String sessionId,
    required String checkpointUuid,
    required String cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_rewind_checkpoint',
      'sessionId': sessionId,
      'checkpointUuid': checkpointUuid,
      'cwd': cwd,
      'requestId': requestId,
    });
    try {
      final response = await _waitFor(
        'cc_checkpoint_rewound',
        requestId: requestId,
      );
      final data = response['data'];
      if (data is Map<String, dynamic>) {
        return data['success'] as bool? ?? false;
      }
      // Backward compatibility (older bridge sent top-level success)
      return response['success'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }

  // ============================================================
  // Claude Code - Chat (Streaming)
  // ============================================================

  void ccChat({
    String? sessionId,
    required String prompt,
    String? cwd,
    String? model,
    ClaudeCodePermissionMode? permissionMode,
    List<String>? allowedTools,
    List<String>? disallowedTools,
    int? maxThinkingTokens,
    String? variant,
    String? activeSubagent,
    List<FileAttachment>? fileAttachments,
  }) {
    final guardKey = 'cc_chat:${sessionId ?? 'new'}:${prompt.hashCode}';
    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return;
    }

    _socket.send({
      'type': 'cc_chat',
      if (sessionId != null) 'sessionId': sessionId,
      'prompt': prompt,
      if (cwd != null) 'cwd': cwd,
      if (model != null) 'model': model,
      if (permissionMode != null) 'permissionMode': permissionMode.wireValue,
      if (allowedTools != null) 'allowedTools': allowedTools,
      if (disallowedTools != null) 'disallowedTools': disallowedTools,
      if (maxThinkingTokens != null) 'maxThinkingTokens': maxThinkingTokens,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (activeSubagent != null) 'activeSubagent': activeSubagent,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments.map((a) => a.toJson()).toList(),
    });
  }

  void ccAbort(String sessionId) {
    _socket.send({'type': 'cc_abort', 'sessionId': sessionId});
  }

  void ccRespondToPermission({
    required String sessionId,
    required String toolUseId,
    required String response,
  }) {
    _socket.send({
      'type': 'cc_permission_response',
      'sessionId': sessionId,
      'toolUseId': toolUseId,
      'response': response,
    });
  }

  Stream<ClaudeCodeStreamMessage> get ccStreamMessages =>
      _socket.messages.where((m) => m['type'] == 'cc_stream').map((m) {
        final data = m['data'] as Map<String, dynamic>? ?? {};
        return ClaudeCodeStreamMessage.fromJson(data);
      });

  // ============================================================
  // Codex (OpenAI Codex app-server)
  // ============================================================

  Stream<CodexStreamMessage> get codexStreamMessages =>
      _socket.messages.where((m) => m['type'] == 'cx_stream').map((m) {
        final data = m['data'] as Map<String, dynamic>? ?? {};
        return CodexStreamMessage.fromJson(data);
      });

  Stream<Map<String, dynamic>> get codexGlobalMessages =>
      _socket.messages.where((m) => m['type'] == 'cx_global').map((m) {
        final data = m['data'];
        if (data is Map<String, dynamic>) return data;
        if (data is Map) return data.cast<String, dynamic>();
        return const <String, dynamic>{};
      });

  Future<Map<String, dynamic>> cxAccountRead({
    bool refreshToken = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_account_read',
      'requestId': requestId,
      if (refreshToken) 'refreshToken': true,
    });
    final response = await _waitFor('cx_account', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxLoginStartChatgpt() async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_login_start',
      'requestId': requestId,
      'loginType': 'chatgpt',
    });
    final response = await _waitFor('cx_login_started', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxLoginStartApiKey(String apiKey) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_login_start',
      'requestId': requestId,
      'loginType': 'apiKey',
      'apiKey': apiKey,
    });
    final response = await _waitFor('cx_login_started', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxLoginCancel(String loginId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_login_cancel',
      'requestId': requestId,
      'loginId': loginId,
    });
    final response = await _waitFor('cx_login_canceled', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxLogout() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_logout', 'requestId': requestId});
    final response = await _waitFor('cx_logged_out', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxRateLimitsRead() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_rate_limits_read', 'requestId': requestId});
    final response = await _waitFor('cx_rate_limits', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxFeedbackUpload({
    required String classification,
    String? reason,
    String? threadId,
    bool includeLogs = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_feedback_upload',
      'requestId': requestId,
      'classification': classification,
      'reason': reason,
      'threadId': threadId,
      'includeLogs': includeLogs,
    });
    final response = await _waitFor(
      'cx_feedback_uploaded',
      requestId: requestId,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<CodexThread> cxThreadRollback({
    required String threadId,
    required int numTurns,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_rollback',
      'requestId': requestId,
      'threadId': threadId,
      'numTurns': numTurns,
    });
    final response = await _waitFor(
      'cx_thread_rolled_back',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<CodexThread> cxThreadFork({required String threadId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_fork',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_forked',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<List<String>> cxUndoFiles({
    required String threadId,
    int count = 1,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_undo_files',
      'requestId': requestId,
      'threadId': threadId,
      if (count != 1) 'count': count,
    });
    final response = await _waitFor(
      'cx_undo_result',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    if (data['ok'] == true) {
      final reverted = data['revertedPaths'] as List<dynamic>? ?? const [];
      return reverted.map((e) => e.toString()).toList();
    }
    final err = data['error']?.toString() ?? 'Undo failed';
    throw Exception(err);
  }

  Future<Map<String, dynamic>> cxReadAgentsMd(String cwd) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_agents_read',
      'requestId': requestId,
      'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_agents',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<bool> cxWriteAgentsMd({
    required String cwd,
    required String content,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_agents_write',
      'requestId': requestId,
      'cwd': cwd,
      'content': content,
    });
    final response = await _waitFor(
      'cx_agents_written',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return data['ok'] == true;
  }

  /// Codex operations require longer timeouts because they spawn `codex app-server`
  /// subprocess on first use, which can take several seconds to initialize.
  static const int _codexTimeoutSeconds = 60;

  Future<List<ProjectSummary>> cxListProjects() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_list_projects', 'requestId': requestId});
    final response = await _waitFor(
      'cx_projects',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(ProjectSummary.fromJson)
        .toList();
  }

  Future<List<CodexThread>> cxListThreads({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_list_threads',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      'cursor': null,
      'limit': 200,
    });
    final response = await _waitFor(
      'cx_threads',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(CodexThread.fromJson)
        .toList();
  }

  Future<CodexThread> cxStartThread({
    required String cwd,
    String? model,
    String? approvalPolicy,
    String? sandbox,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_start_thread',
      'requestId': requestId,
      'cwd': cwd,
      if (model != null) 'model': model,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
    });
    final response = await _waitFor(
      'cx_thread_created',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<CodexThread> cxResumeThread(String threadId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_resume_thread',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<List<CodexTranscriptMessage>> cxGetThreadMessages(
    String threadId,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_thread_messages',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_messages',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(CodexTranscriptMessage.fromJson)
        .toList();
  }

  Future<List<Map<String, dynamic>>> cxListModels() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_model_list', 'requestId': requestId});
    final response = await _waitFor(
      'cx_models',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<bool> cxArchiveThread(String threadId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_archive_thread',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_archived',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] == true;
  }

  Future<List<Map<String, dynamic>>> cxListSkills({
    String? cwd,
    bool forceReload = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_skills_list',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (forceReload) 'forceReload': true,
    });
    final response = await _waitFor(
      'cx_skills',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  String _codexScopeFromSkillSource(SkillSource source) {
    switch (source) {
      case SkillSource.project:
        return 'Repo';
      case SkillSource.user:
        return 'User';
      case SkillSource.admin:
        return 'Admin';
      case SkillSource.plugin:
        return 'System';
      case SkillSource.system:
        return 'System';
    }
  }

  Future<Skill?> cxGetSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.codex,
      name: data['name'] as String? ?? name,
      description: null,
      source: source,
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
      extra: {'scope': data['scope']},
    );
  }

  Future<bool> cxSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_save_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill_saved',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> cxDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_delete_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill_deleted',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<Map<String, dynamic>> cxReadConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_config_read', 'requestId': requestId});
    final response = await _waitFor(
      'cx_config',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxWriteConfigValue({
    required String keyPath,
    required dynamic value,
    String mergeStrategy = 'replace',
  }) async {
    final requestId = _generateRequestId();
    final normalizedMergeStrategy =
        mergeStrategy.trim().toLowerCase() == 'upsert' ? 'upsert' : 'replace';
    _socket.send({
      'type': 'cx_config_value_write',
      'requestId': requestId,
      'keyPath': keyPath,
      'value': value,
      'mergeStrategy': normalizedMergeStrategy,
    });
    final response = await _waitFor(
      'cx_config_written',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<List<Map<String, dynamic>>> cxListMcpServerStatus({
    String? cursor,
    int limit = 200,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_mcp_status_list',
      'requestId': requestId,
      'cursor': cursor,
      'limit': limit,
    });
    final response = await _waitFor(
      'cx_mcp_status',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Hot reload MCP server config (Codex SDK feature)
  /// Reloads MCP config from disk and queues refresh for loaded threads.
  Future<void> cxMcpReload() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_mcp_reload', 'requestId': requestId});
    await _waitFor(
      'cx_mcp_reloaded',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
  }

  Future<Map<String, dynamic>> cxStartReview({
    String? threadId,
    String? cwd,
    String delivery = 'inline',
    Map<String, dynamic>? target,
    String? model,
    String? approvalPolicy,
    String? sandbox,
    Map<String, dynamic>? sandboxPolicy,
    Map<String, dynamic>? config,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_review_start',
      'requestId': requestId,
      if (threadId != null) 'threadId': threadId,
      if (cwd != null) 'cwd': cwd,
      'delivery': delivery,
      if (target != null) 'target': target,
      if (model != null) 'model': model,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
      if (sandboxPolicy != null) 'sandboxPolicy': sandboxPolicy,
      if (config != null) 'config': config,
    });
    final response = await _waitFor(
      'cx_review_started',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  void cxChat({
    String? threadId,
    required String cwd,
    required String prompt,
    String? model,
    String? effort,
    String? summary,
    String? approvalPolicy,
    String? sandbox,
    Map<String, dynamic>? sandboxPolicy,
    Map<String, dynamic>? config,
    List<FileAttachment>? fileAttachments,
    String?
    collaborationMode, // SDK v0.87.0+: 'plan', 'code', 'pair_programming', 'execute', 'custom'
  }) {
    _socket.send({
      'type': 'cx_chat',
      if (threadId != null) 'threadId': threadId,
      'cwd': cwd,
      'prompt': prompt,
      if (model != null) 'model': model,
      if (effort != null) 'effort': effort,
      if (summary != null) 'summary': summary,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
      if (sandboxPolicy != null) 'sandboxPolicy': sandboxPolicy,
      if (config != null) 'config': config,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments.map((a) => a.toJson()).toList(),
      if (collaborationMode != null) 'collaborationMode': collaborationMode,
    });
  }

  void cxAbort({required String threadId, String? turnId}) {
    _socket.send({
      'type': 'cx_abort',
      'threadId': threadId,
      if (turnId != null) 'turnId': turnId,
    });
  }

  void cxRespondToPermission({
    required String requestId,
    required String response,
    Object? execpolicyAmendment,
  }) {
    _socket.send({
      'type': 'cx_permission_response',
      'requestId': requestId,
      'response': response,
      if (execpolicyAmendment != null)
        'execpolicyAmendment': execpolicyAmendment,
    });
  }

  /// Respond to a Codex request_user_input event (SDK v0.87.0+)
  ///
  /// [answers] is a map of question ID to answer object with `selected` and `other` fields.
  void cxRespondToUserInput({
    required String requestId,
    required Map<String, Map<String, dynamic>> answers,
  }) {
    _socket.send({
      'type': 'cx_user_input_response',
      'requestId': requestId,
      'answers': answers,
    });
  }

  // ============================================================
  // Claude Code - Skills, Hooks, Commands
  // ============================================================

  Future<List<ClaudeCodeSkill>> ccListSkills({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_skills',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeSkill.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Skill?> ccGetSkill({
    required ClaudeCodeSkill skill,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_skill',
      'requestId': requestId,
      'name': skill.name,
      'source': skill.source ?? 'project',
      if (cwd != null) 'cwd': cwd,
      if (skill.path != null) 'path': skill.path,
    });
    final response = await _waitFor('cc_skill', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.claudeCode,
      name: data['name'] as String? ?? skill.name,
      description: skill.description,
      source: SkillSource.fromWire(data['source'] as String?),
      path: data['path'] as String? ?? (skill.path ?? ''),
      content: data['content'] as String? ?? '',
      extra: {
        'autoInvoke': skill.autoInvoke,
        if (skill.tags != null) 'tags': skill.tags,
      },
    );
  }

  Future<bool> ccSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_save_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skill_saved', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ccDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skill_deleted', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  // ============================================================
  // Universal Skills API (OpenCode / Claude Code / Codex)
  // ============================================================

  Future<List<Skill>> listSkills({
    required AgentType backend,
    String? cwd,
    bool forceReload = false,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocListSkills(cwd: cwd);
      case AgentType.claudeCode:
        final skills = await ccListSkills(cwd: cwd);
        return skills
            .map(
              (s) => Skill(
                backend: AgentType.claudeCode,
                name: s.name,
                description: s.description,
                source: SkillSource.fromWire(s.source),
                path: s.path ?? '',
                extra: {
                  'autoInvoke': s.autoInvoke,
                  if (s.tags != null) 'tags': s.tags,
                  if (s.agent != null) 'agent': s.agent,
                  if (s.context != null) 'context': s.context,
                },
              ),
            )
            .toList();
      case AgentType.codex:
        final raw = await cxListSkills(cwd: cwd, forceReload: forceReload);
        return raw.map((m) {
          final scope = m['scope'] as String?;
          final source = switch (scope) {
            'Repo' => SkillSource.project,
            'User' => SkillSource.user,
            'Admin' => SkillSource.admin,
            _ => SkillSource.system,
          };
          return Skill(
            backend: AgentType.codex,
            name: m['name'] as String? ?? '',
            description: m['description'] as String?,
            source: source,
            path: m['path'] as String? ?? '',
            extra: {
              'scope': scope,
              if (m['shortDescription'] != null)
                'short_description': m['shortDescription'],
            },
          );
        }).toList();
    }
  }

  Future<Skill?> getSkill({required Skill skill, String? cwd}) async {
    switch (skill.backend) {
      case AgentType.opencode:
        return ocGetSkill(name: skill.name, source: skill.source, cwd: cwd);
      case AgentType.claudeCode:
        final tags = (skill.extra?['tags'] as List?)?.cast<String>();
        final autoInvoke = skill.extra?['autoInvoke'] == true;
        return ccGetSkill(
          skill: ClaudeCodeSkill(
            name: skill.name,
            description: skill.description,
            autoInvoke: autoInvoke,
            tags: tags,
            source: skill.source.wireValue,
            path: skill.path.isEmpty ? null : skill.path,
          ),
          cwd: cwd,
        );
      case AgentType.codex:
        return cxGetSkill(name: skill.name, source: skill.source, cwd: cwd);
    }
  }

  Future<bool> saveSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
      case AgentType.claudeCode:
        return ccSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
      case AgentType.codex:
        return cxSaveSkill(
          name: name,
          source: source,
          content: content,
          cwd: cwd,
        );
    }
  }

  Future<bool> deleteSkill({
    required AgentType backend,
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    switch (backend) {
      case AgentType.opencode:
        return ocDeleteSkill(name: name, source: source, cwd: cwd);
      case AgentType.claudeCode:
        return ccDeleteSkill(name: name, source: source, cwd: cwd);
      case AgentType.codex:
        return cxDeleteSkill(name: name, source: source, cwd: cwd);
    }
  }

  Future<List<ClaudeCodeHook>> ccListHooks({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_hooks',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_hooks', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeHook.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<String> ccReadHooksFile({
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_hooks_file_read',
      'requestId': requestId,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_hooks_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['content'] as String? ?? '{"hooks":{}}';
  }

  Future<bool> ccWriteHooksFile({
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_hooks_file_write',
      'requestId': requestId,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cc_hooks_file_written',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<String> ccReadMcpFile({required String cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_mcp_file_read',
      'requestId': requestId,
      'cwd': cwd,
    });
    final response = await _waitFor('cc_mcp_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['content'] as String? ?? '{"mcpServers":{}}';
  }

  Future<bool> ccWriteMcpFile({
    required String cwd,
    required String content,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_mcp_file_write',
      'requestId': requestId,
      'cwd': cwd,
      'content': content,
    });
    final response = await _waitFor(
      'cc_mcp_file_written',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<ClaudeCodeCommand>> ccListCommands({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_commands',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_commands', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeCommand.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// List filesystem-based agents from .claude/agents/ directories.
  /// Returns raw maps with 'name', 'description', 'source', 'path', 'tools', 'model' keys.
  Future<List<Map<String, dynamic>>> ccListAgents({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_agents',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_agents', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => {
            'name': item['name'] as String? ?? '',
            'description': item['description'] as String? ?? '',
            'source': item['source'] as String? ?? 'filesystem',
            'path': item['path'] as String? ?? '',
            if (item['tools'] != null) 'tools': item['tools'],
            if (item['model'] != null) 'model': item['model'],
          },
        )
        .toList();
  }

  Future<({bool ok, String path, String content})> ccGetCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
    String? path,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_command',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
      if (path != null) 'path': path,
    });
    final response = await _waitFor('cc_command_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return (
      ok: data['ok'] == true,
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ccSaveCommandFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_save_command',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_command_saved', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ccDeleteCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_command',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_command_deleted', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<Map<String, dynamic>>> ccGetActiveSessions() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_get_active_sessions', 'requestId': requestId});
    final response = await _waitFor('cc_active_sessions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  // ============================================================
  // Claude Code - Config
  // ============================================================

  Future<ClaudeCodeConfig> ccGetConfig({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_config',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_config', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ClaudeCodeConfig.fromJson(data);
  }

  Future<ClaudeCodeConfig> ccSetConfig(
    ClaudeCodeConfig config, {
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_set_config',
      'config': config.toJson(),
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_config_updated', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ClaudeCodeConfig.fromJson(data);
  }

  // ============================================================
  // Claude Code - Custom Tools
  // ============================================================

  /// List all custom tools
  Future<List<ClaudeCodeCustomTool>> ccListCustomTools() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_list_custom_tools', 'requestId': requestId});
    final response = await _waitFor('cc_custom_tools', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map(
          (item) => ClaudeCodeCustomTool.fromJson(item as Map<String, dynamic>),
        )
        .toList();
  }

  /// Get a single custom tool by ID
  Future<ClaudeCodeCustomTool?> ccGetCustomTool(String id) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_custom_tool',
      'id': id,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_custom_tool', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodeCustomTool.fromJson(data);
  }

  /// Save (create or update) a custom tool
  Future<ClaudeCodeCustomTool?> ccSaveCustomTool(
    ClaudeCodeCustomTool tool,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_save_custom_tool',
      'tool': tool.toJson(),
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodeCustomTool.fromJson(data);
  }

  /// Delete a custom tool by ID
  Future<bool> ccDeleteCustomTool(String id) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_custom_tool',
      'id': id,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_deleted',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Test a custom tool with sample arguments
  Future<CustomToolTestResult> ccTestCustomTool(
    ClaudeCodeCustomTool tool,
    Map<String, dynamic> testArgs,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_test_custom_tool',
      'tool': tool.toJson(),
      'testArgs': testArgs,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_custom_tool_test_result',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return CustomToolTestResult.fromJson(data);
  }

  // ============================================================
  // Claude Code Plugin Management
  // ============================================================

  /// List all discovered plugins
  Future<List<ClaudeCodePlugin>> ccListPlugins({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_plugins',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugins', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodePlugin.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  /// Get a specific plugin by name
  Future<ClaudeCodePlugin?> ccGetPlugin(String name) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_plugin',
      'name': name,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugin', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ClaudeCodePlugin.fromJson(data);
  }

  /// Toggle a plugin's enabled/disabled state
  Future<bool> ccTogglePlugin(String name, {required bool enabled}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_toggle_plugin',
      'name': name,
      'enabled': enabled,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_plugin_toggled', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// Add a custom plugin path
  Future<bool> ccAddPluginPath(String path) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_add_plugin_path',
      'path': path,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugin_path_added',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Remove a custom plugin path
  Future<bool> ccRemovePluginPath(String path) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_remove_plugin_path',
      'path': path,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugin_path_removed',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  /// Get plugin configuration (enabled/disabled lists, custom paths)
  Future<ClaudeCodePluginConfig> ccGetPluginConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cc_get_plugin_config', 'requestId': requestId});
    final response = await _waitFor('cc_plugin_config', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ClaudeCodePluginConfig.fromJson(data);
  }

  /// Force reload plugins (clear cache and re-discover)
  Future<List<ClaudeCodePlugin>> ccReloadPlugins({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_reload_plugins',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_plugins_reloaded',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodePlugin.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Subscription Usage Tracking
  // ============================================================

  Future<SubscriptionUsage> getSubscriptionUsage() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_subscription_usage', 'requestId': requestId});
    final response = await _waitFor('subscription_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return SubscriptionUsage.fromJson(data);
  }

  Future<ProviderUsage> getProviderUsage(String providerId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_provider_usage',
      'providerId': providerId,
      'requestId': requestId,
    });
    final response = await _waitFor('provider_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ProviderUsage.fromJson(data);
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /// Wait for a bridge response of the given [type].
  ///
  /// [timeoutSeconds] defaults to 10 for most operations, but Codex operations
  /// that require spawning the app-server subprocess should use longer timeouts.
  Future<Map<String, dynamic>> _waitFor(
    String type, {
    String? requestId,
    int timeoutSeconds = 10,
  }) {
    final timeout = Duration(seconds: timeoutSeconds);
    final cacheMaxAge = timeoutSeconds * 1000; // ms

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
