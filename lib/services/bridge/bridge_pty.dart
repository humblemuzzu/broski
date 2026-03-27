part of '../bridge_service.dart';

/// PTY terminal session management.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServicePty on BridgeService {
  // ============================================================
  // PTY Terminal Sessions
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
    Map<String, String>? env,
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
        env: env,
        projectPath: projectPath,
      ),
    );
  }

  Future<Map<String, dynamic>?> _createPtyInternal({
    String? command,
    List<String>? args,
    String? cwd,
    String? title,
    Map<String, String>? env,
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
      if (env != null && env.isNotEmpty) 'env': env,
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
  // PTY Interactive I/O
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
}
