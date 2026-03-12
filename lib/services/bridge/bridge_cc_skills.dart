part of '../bridge_service.dart';

/// Claude Code skills operations.
/// Extracted from bridge_service.dart — Phase 4B modularization.
extension BridgeServiceCcSkills on BridgeService {
  Future<List<ClaudeCodeSkill>> ccListSkills({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_list_skills',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => ClaudeCodeSkill.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Skill?> ccGetSkill({
    required ClaudeCodeSkill skill,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_get_skill',
      'requestId': requestId,
      'name': skill.name,
      'source': skill.source ?? 'project',
      if (cwd != null) 'cwd': cwd,
      if (skill.path != null) 'path': skill.path,
    });
    final response = await _waitFor('cc_skill', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.claudeCode,
      name: data['name'] as String? ?? skill.name,
      description: skill.description,
      source: SkillSource.fromWire(data['source'] as String?),
      path: data['path'] as String? ?? (skill.path ?? ''),
      content: data['content'] as String? ?? '',
      extra: {
        'autoInvoke': skill.autoInvoke,
        if (skill.tags != null) 'tags': skill.tags,
      },
    );
  }

  Future<bool> ccSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_save_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skill_saved', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ccDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_delete_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('cc_skill_deleted', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }
}
