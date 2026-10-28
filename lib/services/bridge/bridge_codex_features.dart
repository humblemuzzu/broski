part of '../bridge_service.dart';

extension BridgeServiceCodexFeatures on BridgeService {
  // Codex — New SDK Features (mid-2026)

  /// Steer/nudge the agent while a turn is active (turn/steer).
  void cxSteer({
    required String threadId,
    required String prompt,
    String? turnId,
  }) {
    _socket.send({
      'type': 'cx_steer',
      'threadId': threadId,
      'prompt': prompt,
      if (turnId != null) 'turnId': turnId,
    });
  }

  /// Rename a thread (thread/name/set).
  Future<bool> cxRenameThread({
    required String threadId,
    required String name,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_rename',
      'requestId': requestId,
      'threadId': threadId,
      'name': name,
    });
    await _waitFor(
      'cx_thread_renamed',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Unarchive a thread (thread/unarchive).
  Future<bool> cxUnarchiveThread({required String threadId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_unarchive',
      'requestId': requestId,
      'threadId': threadId,
    });
    await _waitFor(
      'cx_thread_unarchived',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Trigger context compaction for a thread (thread/compact/start).
  Future<bool> cxCompactThread({required String threadId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_compact',
      'requestId': requestId,
      'threadId': threadId,
    });
    await _waitFor(
      'cx_thread_compacted',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Enable/disable a specific skill (skills/config/write).
  Future<bool> cxSetSkillEnabled({
    required String path,
    required bool enabled,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_skill_config_write',
      'requestId': requestId,
      'path': path,
      'enabled': enabled,
    });
    await _waitFor(
      'cx_skill_config_written',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// List apps/connectors from Codex marketplace (app/list).
  Future<List<Map<String, dynamic>>> cxListApps({
    String? cursor,
    int? limit,
    String? threadId,
    bool forceRefetch = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_apps_list',
      'requestId': requestId,
      if (cursor != null) 'cursor': cursor,
      if (limit != null) 'limit': limit,
      if (threadId != null) 'threadId': threadId,
      if (forceRefetch) 'forceRefetch': true,
    });
    final response = await _waitFor(
      'cx_apps',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Execute a one-off command via Codex (command/exec).
  Future<Map<String, dynamic>> cxCommandExec({
    required List<String> command,
    int? timeoutMs,
    String? cwd,
    Map<String, dynamic>? sandboxPolicy,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_command_exec',
      'requestId': requestId,
      'command': command,
      if (timeoutMs != null) 'timeoutMs': timeoutMs,
      if (cwd != null) 'cwd': cwd,
      if (sandboxPolicy != null) 'sandboxPolicy': sandboxPolicy,
    });
    final response = await _waitFor(
      'cx_command_result',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// List experimental features (experimentalFeature/list).
  Future<List<Map<String, dynamic>>> cxListExperimentalFeatures() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_experimental_features', 'requestId': requestId});
    final response = await _waitFor(
      'cx_experimental_features_list',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  // Codex — SDK Update: New Methods (#21-#25)

  /// #21: Write multiple config values atomically (config/batchWrite).
  Future<Map<String, dynamic>> cxConfigBatchWrite({
    required List<Map<String, dynamic>> edits,
    String? filePath,
    String? expectedVersion,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_config_batch_write',
      'requestId': requestId,
      'edits': edits,
      if (filePath != null) 'filePath': filePath,
      if (expectedVersion != null) 'expectedVersion': expectedVersion,
    });
    final response = await _waitFor(
      'cx_config_batch_written',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// #22: Read org-level config restrictions (configRequirements/read).
  Future<Map<String, dynamic>> cxConfigRequirementsRead() async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_config_requirements_read',
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cx_config_requirements',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// #23: List threads currently loaded in memory (thread/loaded/list).
  Future<List<String>> cxThreadLoadedList({String? cursor, int? limit}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_loaded_list',
      'requestId': requestId,
      if (cursor != null) 'cursor': cursor,
      if (limit != null) 'limit': limit,
    });
    final response = await _waitFor(
      'cx_thread_loaded_list',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((e) => e.toString()).toList();
  }

  /// #24: Read a specific thread with full turns/items (thread/read).
  Future<Map<String, dynamic>> cxThreadRead({
    required String threadId,
    bool includeTurns = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_read',
      'requestId': requestId,
      'threadId': threadId,
      'includeTurns': includeTurns,
    });
    final response = await _waitFor(
      'cx_thread_detail',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// #25: Start MCP server OAuth login flow (mcpServer/oauth/login).
  Future<String> cxMcpOauthLogin({
    required String name,
    List<String>? scopes,
    int? timeoutSecs,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_mcp_oauth_login',
      'requestId': requestId,
      'name': name,
      if (scopes != null) 'scopes': scopes,
      if (timeoutSecs != null) 'timeoutSecs': timeoutSecs,
    });
    final response = await _waitFor(
      'cx_mcp_oauth_login_started',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['authorizationUrl'] as String? ?? '';
  }
}
