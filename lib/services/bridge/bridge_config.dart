part of '../bridge_service.dart';

/// Configuration, provider management, and authentication.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceConfig on BridgeService {
  // ============================================================
  // Config
  // ============================================================

  Future<Map<String, dynamic>> listProviders() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'list_providers', 'requestId': requestId});
    final response = await _waitFor('providers', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> getConfig({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_config',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setConfig(
    Map<String, dynamic> config, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_config',
      'requestId': requestId,
      'config': config,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<Map<String, dynamic>> setModel(
    String model, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_model',
      'model': model,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? const {};
  }

  Future<bool> restartOpenCode() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'restart_opencode', 'requestId': requestId});
    final response = await _waitFor('opencode_restarted', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  void setView({
    String? projectPath,
    String? sessionId,
    String? agent,
    int? lastRuntimeSeq,
  }) {
    final resolvedAgent = agent == null || agent.isEmpty
        ? null
        : AgentType.fromWireValue(agent);
    final resolvedLastSeq =
        lastRuntimeSeq ??
        (resolvedAgent == null
            ? null
            : RuntimeReplayTracker.instance.lastSeq(
                backend: resolvedAgent,
                sessionId: sessionId,
                cwd: projectPath,
              ));
    _socket.send({
      'type': 'set_view',
      if (projectPath != null) 'projectPath': projectPath,
      if (sessionId != null) 'sessionId': sessionId,
      if (agent != null) 'agent': agent,
      if (resolvedLastSeq != null) 'lastRuntimeSeq': resolvedLastSeq,
    });
  }

  Future<Map<String, dynamic>> getGlobalConfig() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'get_global_config', 'requestId': requestId});
    final response = await _waitFor('global_config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  Future<Map<String, dynamic>> setGlobalConfig(
    Map<String, dynamic> config,
  ) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'set_global_config',
      'config': config,
      'requestId': requestId,
    });
    final response = await _waitFor('global_config', requestId: requestId);
    return response['data'] as Map<String, dynamic>? ?? {};
  }

  // ============================================================
  // Provider Management
  // ============================================================

  Future<ProviderInfo> listAllProviders({String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'list_all_providers',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('all_providers', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    return ProviderInfo.fromJson(data);
  }

  Future<Map<String, List<ProviderAuthMethod>>> getProviderAuth({
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'get_provider_auth',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('provider_auth', requestId: requestId);
    final data = response['data'] as Map<String, dynamic>? ?? {};
    final result = <String, List<ProviderAuthMethod>>{};
    for (final entry in data.entries) {
      final methods = (entry.value as List<dynamic>? ?? [])
          .map((m) => ProviderAuthMethod.fromJson(m as Map<String, dynamic>))
          .toList();
      result[entry.key] = methods;
    }
    return result;
  }

  Future<ProviderAuthAuthorization?> providerOauthAuthorize({
    required String providerId,
    required int method,
    String? projectPath,
    Map<String, String>? inputs,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'provider_oauth_authorize',
      'providerId': providerId,
      'method': method,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (inputs != null && inputs.isNotEmpty) 'inputs': inputs,
    });
    final response = await _waitFor(
      'provider_oauth_authorized',
      requestId: requestId,
    );
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return ProviderAuthAuthorization.fromJson(data);
  }

  Future<bool> providerOauthCallback({
    required String providerId,
    required int method,
    String? code,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'provider_oauth_callback',
      'providerId': providerId,
      'method': method,
      'requestId': requestId,
      if (code != null && code.isNotEmpty) 'code': code,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'provider_oauth_callback',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Provider Credential Management
  // ============================================================

  Future<bool> authSet(
    String providerId,
    Map<String, dynamic> auth, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'auth_set',
      'providerId': providerId,
      'auth': auth,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('auth_set_result', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  Future<bool> authRemove(String providerId, {String? projectPath}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'auth_remove',
      'providerId': providerId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'auth_removed_result',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // OpenCode Health Check
  // ============================================================

  /// Get OpenCode health status including version.
  Future<Map<String, dynamic>?> getOpenCodeHealth() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'oc_health', 'requestId': requestId});
    final response = await _waitFor('oc_health_result', requestId: requestId);
    return response['data'] as Map<String, dynamic>?;
  }
}
