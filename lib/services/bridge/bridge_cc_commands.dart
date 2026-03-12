part of '../bridge_service.dart';

/// Claude Code slash-commands operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcCommands on BridgeService {
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
}
