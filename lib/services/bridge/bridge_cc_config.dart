part of '../bridge_service.dart';

/// Claude Code configuration and account methods.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceCcConfig on BridgeService {
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

  Future<List<ClaudeCodeSupportedModel>> ccGetSupportedModels({
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_supported_models',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_supported_models',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map(
          (item) =>
              ClaudeCodeSupportedModel.fromJson(item.cast<String, dynamic>()),
        )
        .toList();
  }

  Future<ClaudeCodeAccountInfo> ccGetAccountInfo({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_account_info',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor('cc_account_info', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ClaudeCodeAccountInfo.fromJson(data);
  }

  Future<List<ClaudeCodeMcpServerStatus>> ccGetMcpServerStatus({
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_mcp_server_status',
      if (cwd != null) 'cwd': cwd,
      'requestId': requestId,
    });
    final response = await _waitFor(
      'cc_mcp_server_status',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map>()
        .map(
          (item) =>
              ClaudeCodeMcpServerStatus.fromJson(item.cast<String, dynamic>()),
        )
        .toList();
  }
}
