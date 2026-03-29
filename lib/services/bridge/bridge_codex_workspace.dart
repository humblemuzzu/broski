part of '../bridge_service.dart';

/// Codex workspace operations: change sets, diffs, revert, PTY commands,
/// thread management, external config import, and rate limits.
extension BridgeServiceCodexWorkspace on BridgeService {
  // Codex — Workspace Change Set (Revert)

  /// Revert file changes using git apply --reverse.
  Future<Map<String, dynamic>> cxRevertChanges({
    required String threadId,
    required String diff,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_revert_changes',
      'requestId': requestId,
      'threadId': threadId,
      'diff': diff,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_changes_reverted',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// Get the git diff for the current turn's changes.
  Future<Map<String, dynamic>> cxGetTurnDiff({
    required String threadId,
    String? turnId,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_turn_diff',
      'requestId': requestId,
      'threadId': threadId,
      if (turnId != null) 'turnId': turnId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_turn_diff',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  // PTY Command Methods

  /// Write to stdin of a running PTY command (command/exec/write).
  void cxCommandExecWrite({
    required String processId,
    String? deltaBase64,
    bool closeStdin = false,
  }) {
    _socket.send({
      'type': 'cx_command_write',
      'processId': processId,
      if (deltaBase64 != null) 'deltaBase64': deltaBase64,
      if (closeStdin) 'closeStdin': true,
    });
  }

  /// Resize a PTY terminal (command/exec/resize).
  void cxCommandExecResize({
    required String processId,
    required int rows,
    required int cols,
  }) {
    _socket.send({
      'type': 'cx_command_resize',
      'processId': processId,
      'rows': rows,
      'cols': cols,
    });
  }

  /// Terminate a running PTY command (command/exec/terminate).
  Future<bool> cxCommandExecTerminate({required String processId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_command_terminate',
      'requestId': requestId,
      'processId': processId,
    });
    await _waitFor(
      'cx_command_terminated',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Update thread metadata (e.g., git info) after branch switch.
  Future<bool> cxUpdateThreadMetadata({
    required String threadId,
    Map<String, dynamic>? gitInfo,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_metadata_update',
      'requestId': requestId,
      'threadId': threadId,
      if (gitInfo != null) 'gitInfo': gitInfo,
    });
    await _waitFor(
      'cx_thread_metadata_updated',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  // Thread Unsubscribe + Collaboration Modes + Background Terminals

  /// Unsubscribe from a thread to free server memory (thread/unsubscribe).
  Future<String> cxThreadUnsubscribe({required String threadId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_thread_unsubscribe',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_unsubscribed',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['status'] as String? ?? 'unsubscribed';
  }

  /// List available collaboration modes (collaborationMode/list).
  Future<List<Map<String, dynamic>>> cxListCollaborationModes({
    String? threadId,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_collaboration_modes',
      'requestId': requestId,
      if (threadId != null) 'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_collaboration_modes_list',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Clean up background terminals for a thread (thread/backgroundTerminals/clean).
  Future<bool> cxCleanBackgroundTerminals({required String threadId}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_background_terminals_clean',
      'requestId': requestId,
      'threadId': threadId,
    });
    await _waitFor(
      'cx_background_terminals_cleaned',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  // External Agent Config Import

  /// Detect external agent configs (Claude Code, Cursor, Windsurf, etc.)
  Future<List<Map<String, dynamic>>> cxDetectExternalConfigs({
    List<String>? cwds,
    bool includeHome = true,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_external_config_detect',
      'requestId': requestId,
      if (cwds != null) 'cwds': cwds,
      'includeHome': includeHome,
    });
    final response = await _waitFor(
      'cx_external_configs',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Import an external agent config.
  Future<bool> cxImportExternalConfig({
    required String source,
    String? configPath,
    Map<String, dynamic>? importOptions,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_external_config_import',
      'requestId': requestId,
      'source': source,
      if (configPath != null) 'configPath': configPath,
      if (importOptions != null) 'importOptions': importOptions,
    });
    await _waitFor(
      'cx_external_config_imported',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return true;
  }

  /// Read account rate limits (account/rateLimits/read).
  /// Returns rate limit info including usage, limits, reset time.
  Future<Map<String, dynamic>> cxReadRateLimits() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_rate_limits_read', 'requestId': requestId});
    final response = await _waitFor(
      'cx_rate_limits',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] as Map<String, dynamic>? ?? {};
  }
}
