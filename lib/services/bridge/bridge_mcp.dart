part of '../bridge_service.dart';

/// MCP server management and OAuth authentication.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceMcp on BridgeService {
  // ============================================================
  // MCP Server Management
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

  Future<Map<String, McpServerStatus>> addMcpServer({
    required String name,
    required Map<String, dynamic> config,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'add_mcp',
      'name': name,
      'config': config,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_added', requestId: requestId);
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
  // MCP OAuth Authentication
  // ============================================================

  Future<Map<String, dynamic>?> mcpAuthStart(
    String name, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'mcp_auth_start',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_auth_started', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    return null;
  }

  Future<bool> mcpAuthCallback(
    String name,
    String code, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'mcp_auth_callback',
      'name': name,
      'code': code,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_auth_completed', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  /// One-shot MCP OAuth: opens browser on the dev machine, waits for
  /// callback, returns final MCP status map (or null on failure).
  Future<Map<String, dynamic>?> mcpAuthAuthenticate(
    String name, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'mcp_auth_authenticate',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'mcp_auth_authenticated',
      requestId: requestId,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    return null;
  }

  Future<bool> mcpAuthRemove(String name, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'mcp_auth_remove',
      'name': name,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('mcp_auth_removed', requestId: requestId);
    return response['data'] as bool? ?? false;
  }
}
