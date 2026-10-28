part of '../bridge_service.dart';

/// Codex operations require longer timeouts because they spawn `codex app-server`
/// subprocess on first use, which can take several seconds to initialize.
const int _codexTimeoutSeconds = 60;

extension BridgeServiceCodexCore on BridgeService {
  // ============================================================
  // Codex (OpenAI Codex app-server)
  // ============================================================

  /// #19: Stream of app/list/updated notifications from Codex.
  Stream<List<Map<String, dynamic>>> get codexAppsUpdatedMessages =>
      _socket.messages.where((m) => m['type'] == 'cx_apps_updated').map((m) {
        final data = m['data'] as List<dynamic>? ?? [];
        return data.whereType<Map<String, dynamic>>().toList();
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
    List<String>? extraLogFiles,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_feedback_upload',
      'requestId': requestId,
      'classification': classification,
      'reason': reason,
      'threadId': threadId,
      'includeLogs': includeLogs,
      if (extraLogFiles != null) 'extraLogFiles': extraLogFiles,
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

  /// Warm up Codex filesystem caches (projects + threads) in bridge.
  ///
  /// This improves first-open latency in sessions views. The bridge starts
  /// warmup asynchronously and immediately responds with `cx_warmup_started`.
  Future<void> cxWarmup() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_warmup', 'requestId': requestId});
    await _waitFor(
      'cx_warmup_started',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
  }
}
