part of '../bridge_service.dart';

/// Miscellaneous bridge operations: devices, tools, formatters,
/// usage, projects, message parts, LSP, agents.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceMisc on BridgeService {
  // ============================================================
  // Multi-Device Support
  // ============================================================

  void registerDevice({
    required String deviceId,
    required String deviceName,
    required String platform,
  }) {
    _socket.send({
      'type': 'register_device',
      'deviceId': deviceId,
      'deviceName': deviceName,
      'platform': platform,
      'protocolVersion': BridgeService.protocolVersion,
    });
  }

  Future<List<Map<String, dynamic>>> listPendingPermissions({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_pending_permissions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'pending_permissions',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<List<Map<String, dynamic>>> listPendingQuestions({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_pending_questions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('pending_questions', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  Future<List<DeviceInfo>> listDevices() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_devices', 'requestId': requestId});
    final response = await _waitFor('devices', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => DeviceInfo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  void disconnectDevice(String deviceId) {
    _socket.send({'type': 'disconnect_device', 'deviceId': deviceId});
  }

  Future<bool> disposeInstance({String? projectPath}) {
    final dedupeKey = 'dispose_instance:${projectPath ?? 'current'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _disposeInstanceInternal(projectPath: projectPath),
    );
  }

  Future<bool> _disposeInstanceInternal({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'dispose_instance',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('instance_disposed', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Agent Type Management
  // ============================================================

  Future<AgentsStatus> getAgentsStatus() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_agents_status', 'requestId': requestId});
    final response = await _waitFor('agents_status', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return AgentsStatus.fromJson(data);
  }

  void setAgent(AgentType agentType) {
    _socket.send({'type': 'set_agent', 'agent': agentType.wireValue});
  }

  // ============================================================
  // LSP Status
  // ============================================================

  Future<List<dynamic>> getLspStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_lsp_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('lsp_status', requestId: requestId);
    return response['data'] as List<dynamic>? ?? [];
  }

  // ============================================================
  // Tool List
  // ============================================================

  Future<List<String>> listToolIds({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_tool_ids',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('tool_ids', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((t) => t.toString()).toList();
  }

  Future<List<ToolInfo>> listTools({
    required String provider,
    required String model,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_tools',
      'provider': provider,
      'model': model,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('tools', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((t) => ToolInfo.fromJson(t as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Formatter Status
  // ============================================================

  Future<List<FormatterInfo>> getFormatterStatus({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_formatter_status',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('formatter_status', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((f) => FormatterInfo.fromJson(f as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Subscription Usage
  // ============================================================

  Future<SubscriptionUsage> getSubscriptionUsage() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_subscription_usage', 'requestId': requestId});
    final response = await _waitFor('subscription_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return SubscriptionUsage.fromJson(data);
  }

  Future<ProviderUsage> getProviderUsage(String providerId) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_provider_usage',
      'providerId': providerId,
      'requestId': requestId,
    });
    final response = await _waitFor('provider_usage', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ProviderUsage.fromJson(data);
  }

  // ============================================================
  // Project Management
  // ============================================================

  Future<Map<String, dynamic>?> getCurrentProject({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_current_project',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('current_project', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }

  Future<Map<String, dynamic>> updateProject({
    required String projectId,
    String? name,
    Map<String, dynamic>? icon,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'update_project',
      'projectId': projectId,
      'requestId': requestId,
      if (name != null) 'name': name,
      if (icon != null) 'icon': icon,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('project_updated', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  // ============================================================
  // Message Part Editing
  // ============================================================

  Future<bool> deletePart({
    required String sessionId,
    required String messageId,
    required String partId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'delete_part',
      'sessionId': sessionId,
      'messageId': messageId,
      'partId': partId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('part_deleted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<Map<String, dynamic>?> updatePart({
    required String sessionId,
    required String messageId,
    required String partId,
    required Map<String, dynamic> part,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'update_part',
      'sessionId': sessionId,
      'messageId': messageId,
      'partId': partId,
      'part': part,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('part_updated', requestId: requestId);
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    return null;
  }
}
