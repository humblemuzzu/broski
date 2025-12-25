import 'dart:async';
import 'dart:developer' as developer;
import 'dart:math';

import '../models/agent.dart';
import '../models/command.dart';
import '../models/file_content.dart';
import '../models/mcp.dart';
import '../models/project.dart';
import '../models/provider.dart';
import '../models/search_result.dart';
import '../models/session.dart';
import '../models/todo.dart';
import '../models/tool.dart';
import '../models/vcs.dart';
import 'websocket_service.dart';

class BridgeService {
  BridgeService(this._socket);

  final WebSocketService _socket;
  final _random = Random();
  int _requestCounter = 0;

  // ============================================================
  // In-flight Request Deduplication
  // ============================================================
  final Map<String, Future<dynamic>> _inFlightRequests = {};

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

  Future<Map<String, dynamic>> getConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_config', 'requestId': requestId});
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setModel(String model) async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'set_model', 'model': model, 'requestId': requestId});
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<bool> restartOpenCode() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'restart_opencode', 'requestId': requestId});
    final response = await _waitFor('opencode_restarted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  void setView({String? projectPath, String? sessionId}) {
    _socket.send({
      'type': 'set_view',
      if (projectPath != null) 'projectPath': projectPath,
      if (sessionId != null) 'sessionId': sessionId,
    });
  }

  Future<SessionSummary> createSession({
    String? projectPath,
    String? title,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_session',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (title != null) 'title': title,
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

  /// Send a chat message to a session
  ///
  /// [agent] - Optional agent to use ("build" for full access, "plan" for read-only)
  /// [disabledTools] - Optional list of tool IDs to disable for this request
  void sendChat({
    required String sessionId,
    required String content,
    String? projectPath,
    String? providerID,
    String? modelID,
    String? agent,
    List<String>? disabledTools,
  }) {
    _socket.send({
      'type': 'chat',
      'sessionId': sessionId,
      'content': content,
      if (projectPath != null) 'projectPath': projectPath,
      if (providerID != null && modelID != null)
        'model': {'providerID': providerID, 'modelID': modelID},
      if (agent != null) 'agent': agent,
      if (disabledTools != null && disabledTools.isNotEmpty)
        'disabledTools': disabledTools,
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

  void respondToPermission({
    required String sessionId,
    required String permissionId,
    required String response,
    String? projectPath,
  }) {
    _socket.send({
      'type': 'permission_response',
      'sessionId': sessionId,
      'permissionId': permissionId,
      'response': response,
      if (projectPath != null) 'projectPath': projectPath,
    });
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

  /// Execute a slash command
  void executeCommand({
    required String sessionId,
    required String command,
    required String arguments,
    String? projectPath,
    String? agent,
    String? model,
  }) {
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

  /// Delete a session
  Future<bool> deleteSession(String sessionId, {String? projectPath}) async {
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

  /// Update session (rename title, archive)
  Future<SessionSummary> updateSession(
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
  ///
  /// [messageId] - Optional message ID to fork from; if omitted, forks at end
  Future<SessionSummary> forkSession(
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
  ///
  /// [partId] - Optional part ID to revert a specific tool call
  Future<SessionSummary> revertMessage(
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
  Future<SessionSummary> unrevertSession(
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
  Future<SessionSummary> shareSession(
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
  Future<SessionSummary> unshareSession(
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
  ///
  /// This will summarize old messages and reduce token usage.
  /// Returns true if summarization was successful.
  Future<bool> summarizeSession(
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

  /// Read the contents of a file
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

  // ============================================================
  // Feature 12: File Search
  // ============================================================

  /// Find files by name (glob search)
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

  /// Find text in files (ripgrep search)
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

  /// Create a new PTY session
  Future<Map<String, dynamic>?> createPty({
    String? command,
    List<String>? args,
    String? cwd,
    String? title,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'create_pty',
      'requestId': requestId,
      if (command != null) 'command': command,
      if (args != null) 'args': args,
      if (cwd != null) 'cwd': cwd,
      if (title != null) 'title': title,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pty_created', requestId: requestId);
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

  /// Update a PTY session (title, size)
  Future<Map<String, dynamic>?> updatePty(
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

  /// Delete a PTY session
  Future<bool> deletePty(String ptyId, {String? projectPath}) async {
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

  /// Connect to an MCP server
  Future<bool> connectMcp(String name, {String? projectPath}) async {
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

  /// Disconnect from an MCP server
  Future<bool> disconnectMcp(String name, {String? projectPath}) async {
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

  /// Set API key for a provider
  Future<bool> setApiKey({
    required String providerID,
    required String key,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_api_key',
      'providerID': providerID,
      'key': key,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('api_key_set', requestId: requestId);
    return response['data'] as bool? ?? false;
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
  ///
  /// This analyzes the project and generates an AGENTS.md file
  /// with project-specific instructions for the AI.
  Future<bool> initSession({
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
  // Private helpers
  // ============================================================

  Future<Map<String, dynamic>> _waitFor(String type, {String? requestId}) {
    return _socket.messages
        .firstWhere((message) {
          if (message['type'] != type) return false;
          // If we have a requestId, match it; otherwise accept any matching type
          if (requestId != null && message['requestId'] != null) {
            return message['requestId'] == requestId;
          }
          return true;
        })
        .timeout(
          const Duration(seconds: 10),
          onTimeout: () =>
              throw TimeoutException('Bridge response timeout: $type'),
        );
  }
}
