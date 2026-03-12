part of '../bridge_service.dart';

/// Claude Code agents and memory operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcMemory on BridgeService {
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

  /// List memory entries from ~/.claude/memory/ directories
  Future<List<ClaudeCodeMemoryEntry>> ccListMemories({
    String? scope,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_memories',
      'requestId': requestId,
      if (scope != null) 'scope': scope,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_memories', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map((item) => ClaudeCodeMemoryEntry.fromJson(item))
        .toList();
  }

  /// Delete a specific memory entry
  Future<bool> ccDeleteMemory({
    required String scope,
    required String filename,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_memory',
      'requestId': requestId,
      'scope': scope,
      'filename': filename,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_memory_deleted', requestId: requestId);
    return (response['data'] as Map<String, dynamic>?)?['ok'] == true;
  }
}
