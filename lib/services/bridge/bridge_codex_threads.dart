part of '../bridge_service.dart';

extension BridgeServiceCodexThreads on BridgeService {
  Future<List<CodexThread>> cxListThreads({
    String? cwd,
    List<String>? sourceKinds,
    String? sortKey,
    List<String>? modelProviders,
    bool? archived,
    String? searchTerm,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_list_threads',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      'cursor': null,
      'limit': 200,
      if (sourceKinds != null) 'sourceKinds': sourceKinds,
      if (sortKey != null) 'sortKey': sortKey,
      if (modelProviders != null) 'modelProviders': modelProviders,
      if (archived != null) 'archived': archived,
      if (searchTerm != null) 'searchTerm': searchTerm,
    });
    final response = await _waitFor(
      'cx_threads',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(CodexThread.fromJson)
        .toList();
  }

  /// Paginated thread listing — returns threads plus the cursor for the
  /// next page. Used by infinite scroll in the threads list.
  Future<({List<CodexThread> threads, String? nextCursor})> cxListThreadsPage({
    String? cwd,
    String? cursor,
    int limit = 50,
    List<String>? sourceKinds,
    String? sortKey,
    List<String>? modelProviders,
    bool? archived,
    String? searchTerm,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_list_threads',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (cursor != null) 'cursor': cursor,
      'limit': limit,
      if (sourceKinds != null) 'sourceKinds': sourceKinds,
      if (sortKey != null) 'sortKey': sortKey,
      if (modelProviders != null) 'modelProviders': modelProviders,
      if (archived != null) 'archived': archived,
      if (searchTerm != null) 'searchTerm': searchTerm,
    });
    final response = await _waitFor(
      'cx_threads',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    final nc = response['nextCursor']?.toString();
    return (
      threads: data
          .whereType<Map<String, dynamic>>()
          .map(CodexThread.fromJson)
          .toList(),
      nextCursor: (nc != null && nc.isNotEmpty && nc != 'null') ? nc : null,
    );
  }

  Future<CodexThread> cxStartThread({
    required String cwd,
    String? model,
    String? approvalPolicy,
    String? sandbox,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_start_thread',
      'requestId': requestId,
      'cwd': cwd,
      if (model != null) 'model': model,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
    });
    final response = await _waitFor(
      'cx_thread_created',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<CodexThread> cxResumeThread(String threadId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_resume_thread',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? const {};
    return CodexThread.fromJson(data);
  }

  Future<List<CodexTranscriptMessage>> cxGetThreadMessages(
    String threadId,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_thread_messages',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_messages',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(CodexTranscriptMessage.fromJson)
        .toList();
  }

  Future<List<Map<String, dynamic>>> cxGetModifiedFiles(String threadId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_modified_files',
      'requestId': requestId,
      'threadId': threadId,
    });
    try {
      final response = await _waitFor(
        'cx_modified_files',
        requestId: requestId,
      );
      final data = response['data'] as List<dynamic>? ?? const [];
      return data.whereType<Map<String, dynamic>>().toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<List<Map<String, dynamic>>> cxListModels() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_model_list', 'requestId': requestId});
    final response = await _waitFor(
      'cx_models',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<bool> cxArchiveThread(String threadId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_archive_thread',
      'requestId': requestId,
      'threadId': threadId,
    });
    final response = await _waitFor(
      'cx_thread_archived',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    return response['data'] == true;
  }

  Future<List<Map<String, dynamic>>> cxListSkills({
    String? cwd,
    bool forceReload = false,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_skills_list',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
      if (forceReload) 'forceReload': true,
    });
    final response = await _waitFor(
      'cx_skills',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  String _codexScopeFromSkillSource(SkillSource source) {
    switch (source) {
      case SkillSource.project:
        return 'Repo';
      case SkillSource.user:
        return 'User';
      case SkillSource.admin:
        return 'Admin';
      case SkillSource.plugin:
      case SkillSource.system:
      case SkillSource.builtin:
        return 'System';
    }
  }

  Future<Skill?> cxGetSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_get_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return Skill(
      backend: AgentType.codex,
      name: data['name'] as String? ?? name,
      description: null,
      source: source,
      path: data['path'] as String? ?? '',
      content: data['content'] as String? ?? '',
      extra: {'scope': data['scope']},
    );
  }

  Future<bool> cxSaveSkill({
    required String name,
    required SkillSource source,
    required String content,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_save_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      'content': content,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill_saved',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<bool> cxDeleteSkill({
    required String name,
    required SkillSource source,
    String? cwd,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_delete_skill',
      'requestId': requestId,
      'name': name,
      'scope': _codexScopeFromSkillSource(source),
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_skill_deleted',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return data['ok'] == true;
  }

  Future<List<CodexPrompt>> cxListPrompts({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_list_prompts',
      'requestId': requestId,
      if (cwd != null) 'cwd': cwd,
    });
    final response = await _waitFor(
      'cx_prompts',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => CodexPrompt.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> cxReadConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_config_read', 'requestId': requestId});
    final response = await _waitFor(
      'cx_config',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  Future<Map<String, dynamic>> cxWriteConfigValue({
    required String keyPath,
    required dynamic value,
    String mergeStrategy = 'replace',
  }) async {
    final requestId = _generateRequestId();
    final normalizedMergeStrategy =
        mergeStrategy.trim().toLowerCase() == 'upsert' ? 'upsert' : 'replace';
    _socket.send({
      'type': 'cx_config_value_write',
      'requestId': requestId,
      'keyPath': keyPath,
      'value': value,
      'mergeStrategy': normalizedMergeStrategy,
    });
    final response = await _waitFor(
      'cx_config_written',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }
}
