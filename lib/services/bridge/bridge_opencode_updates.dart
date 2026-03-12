part of '../bridge_service.dart';

extension BridgeOpenCodeUpdates on BridgeService {
  Future<bool> ocDeleteMessage({
    required String sessionId,
    required String messageId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_delete_message',
      'requestId': requestId,
      'sessionId': sessionId,
      'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_message_deleted', requestId: requestId);
    return response['data'] == true;
  }

  Future<Map<String, dynamic>?> ocGetMessage({
    required String sessionId,
    required String messageId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_message',
      'requestId': requestId,
      'sessionId': sessionId,
      'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_message', requestId: requestId);
    final data = response['data'];
    return data is Map<String, dynamic> ? data : null;
  }

  Future<List<Skill>> ocListSdkSkills({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_sdk_skills',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_sdk_skills', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => Skill(
            backend: AgentType.opencode,
            name: item['name'] as String? ?? '',
            description: item['description'] as String?,
            source: SkillSource.builtin,
            path: item['location'] as String? ?? '',
            content: item['content'] as String?,
            extra: {
              if (item['location'] != null) 'location': item['location'],
              'sdk': true,
            },
          ),
        )
        .toList();
  }

  Future<List<Map<String, dynamic>>> ocListWorkspaces({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_list_workspaces',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_workspaces', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? const [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<Map<String, dynamic>?> ocCreateWorkspace({
    required String id,
    String? branch,
    String? configDirectory,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_create_workspace',
      'requestId': requestId,
      'id': id,
      if (branch != null) 'branch': branch,
      if (configDirectory != null) 'configDirectory': configDirectory,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_workspace_created',
      requestId: requestId,
    );
    return response['data'] as Map<String, dynamic>?;
  }

  Future<bool> ocRemoveWorkspace({
    required String id,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_remove_workspace',
      'requestId': requestId,
      'id': id,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_workspace_removed',
      requestId: requestId,
    );
    return response['data'] == true;
  }

  /// Initialize a git repository for the current project.
  Future<bool> ocInitGit({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_init_git',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'oc_git_initialized',
      requestId: requestId,
    );
    return response['data'] == true;
  }

  /// Get important paths (state, config, worktree, directory).
  Future<Map<String, dynamic>> ocGetPaths({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_get_paths',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('oc_paths', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  /// Run a shell command in the context of an OpenCode session.
  /// The agent sees the output and can respond to it.
  Future<dynamic> ocSessionShell({
    required String sessionId,
    required String command,
    String? projectPath,
    String? agent,
    String? model,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'oc_session_shell',
      'requestId': requestId,
      'sessionId': sessionId,
      'command': command,
      if (projectPath != null) 'projectPath': projectPath,
      if (agent != null) 'agent': agent,
      if (model != null) 'model': model,
    });
    final response = await _waitFor(
      'oc_session_shell_result',
      requestId: requestId,
    );
    return response['data'];
  }
}
