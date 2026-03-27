part of '../bridge_service.dart';

/// OpenCode features: skills, plugins, commands, agents, questions.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceOpenCodeFeatures on BridgeService {
  // ============================================================
  // OpenCode - Question Tool
  // ============================================================

  Future<bool> ocReplyToQuestion({
    required String requestId,
    required List<List<String>> answers,
    String? projectPath,
  }) async {
    final wireRequestId = _generateRequestId();
    _socket.send({
      'type': 'oc_question_reply',
      'requestId': wireRequestId,
      'questionId': requestId,
      'answers': answers,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_question_replied',
      requestId: wireRequestId,
    );
    return response['data'] == true;
  }

  Future<bool> ocRejectQuestion({
    required String requestId,
    String? projectPath,
  }) async {
    final wireRequestId = _generateRequestId();
    _socket.send({
      'type': 'oc_question_reject',
      'requestId': wireRequestId,
      'questionId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_question_rejected',
      requestId: wireRequestId,
    );
    return response['data'] == true;
  }

  // ============================================================
  // OpenCode - Skills (filesystem-backed)
  // ============================================================

  Future<List<Skill>> ocListSkills({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_skills',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(
          (m) => Skill(
            backend: AgentType.opencode,
            name: m['name'] as String? ?? '',
            description: m['description'] as String?,
            source: SkillSource.fromWire(m['source'] as String?),
            path: m['path'] as String? ?? '',
          ),
        )
        .toList();
  }

  Future<Skill?> ocGetSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.opencode,
      name: data['name'] as String? ?? name,
      description: null,
      source: SkillSource.fromWire(data['source'] as String?),
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill_saved', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_skill',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_skill_deleted', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  // ============================================================
  // OpenCode - Plugin Files
  // ============================================================

  Future<List<OpenCodePluginFile>> ocListPluginFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_plugin_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_plugin_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodePluginFile.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>?> ocGetPluginFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_plugin_file', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }

  Future<bool> ocSavePluginFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_plugin_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeletePluginFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_plugin_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_plugin_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  // ============================================================
  // OpenCode - Custom Commands / Agents (filesystem-backed)
  // ============================================================

  Future<List<OpenCodeMarkdownFile>> ocListCommandFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_command_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_command_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodeMarkdownFile.fromJson)
        .toList();
  }

  Future<({String path, String content})> ocGetCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_command_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return (
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveCommandFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_command_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteCommandFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_command_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_command_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<OpenCodeMarkdownFile>> ocListAgentFiles({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_agent_files',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_agent_files', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(OpenCodeMarkdownFile.fromJson)
        .toList();
  }

  Future<({String path, String content})> ocGetAgentFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor('oc_agent_file', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return (
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
    );
  }

  Future<bool> ocSaveAgentFile({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_save_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_agent_file_saved',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> ocDeleteAgentFile({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_agent_file',
      'requestId': requestId,
      'name': name,
      'source': source.wireValue,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'oc_agent_file_deleted',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  // ============================================================
  // SDK Skills Endpoint (supplements filesystem scanning)
  // ============================================================

  Future<List<Map<String, dynamic>>> listSdkSkills({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_sdk_skills',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_sdk_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }
}
