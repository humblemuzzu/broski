part of '../bridge_service.dart';

/// Claude Code hooks and MCP file operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcHooksMcp on BridgeService {
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
}
