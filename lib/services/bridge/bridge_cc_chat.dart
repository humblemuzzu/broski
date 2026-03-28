part of '../bridge_service.dart';

/// Claude Code chat (streaming) and mid-session control methods.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceCcChat on BridgeService {
  // ============================================================
  // Claude Code - Chat (Streaming)
  // ============================================================

  void ccChat({
    String? sessionId,
    required String prompt,
    String? cwd,
    String? model,
    ClaudeCodePermissionMode? permissionMode,
    List<String>? allowedTools,
    List<String>? disallowedTools,
    int? maxThinkingTokens,
    int? maxTurns,
    double? maxBudgetUsd,
    List<String>? betas,
    String? variant,
    ClaudeCodeThinkingOption? thinking,
    ClaudeCodeEffort? effort,
    String? agent,
    String? activeSubagent,
    String? resumeSessionAt,
    ClaudeCodeOutputFormat? outputFormat,
    ClaudeCodeSandboxSettings? sandbox,
    bool? enableAgentTeams,
    bool? persistSession,
    bool? enableClaudeAiMcpServers,
    String? fallbackModel,
    List<String>? additionalDirectories,
    List<FileAttachment>? fileAttachments,
  }) {
    final guardKey = 'cc_chat:${sessionId ?? 'new'}:${prompt.hashCode}';
    if (!_guardFireAndForget(guardKey, cooldown: const Duration(seconds: 2))) {
      return;
    }

    _socket.send({
      'type': 'cc_chat',
      if (sessionId != null) 'sessionId': sessionId,
      'prompt': prompt,
      if (cwd != null) 'cwd': cwd,
      if (model != null) 'model': model,
      if (permissionMode != null) 'permissionMode': permissionMode.wireValue,
      if (allowedTools != null) 'allowedTools': allowedTools,
      if (disallowedTools != null) 'disallowedTools': disallowedTools,
      if (maxThinkingTokens != null) 'maxThinkingTokens': maxThinkingTokens,
      if (maxTurns != null) 'maxTurns': maxTurns,
      if (maxBudgetUsd != null) 'maxBudgetUsd': maxBudgetUsd,
      if (betas != null && betas.isNotEmpty) 'betas': betas,
      if (variant != null && variant.isNotEmpty) 'variant': variant,
      if (thinking != null) 'thinking': thinking.toJson(),
      if (effort != null) 'effort': effort.wireValue,
      if (agent != null) 'agent': agent,
      if (activeSubagent != null) 'activeSubagent': activeSubagent,
      if (resumeSessionAt != null && resumeSessionAt.isNotEmpty)
        'resumeSessionAt': resumeSessionAt,
      if (outputFormat != null) 'outputFormat': outputFormat.toJson(),
      if (sandbox != null) 'sandbox': sandbox.toJson(),
      if (enableAgentTeams != null) 'enableAgentTeams': enableAgentTeams,
      if (persistSession != null) 'persistSession': persistSession,
      if (enableClaudeAiMcpServers != null)
        'enableClaudeAiMcpServers': enableClaudeAiMcpServers,
      if (fallbackModel != null) 'fallbackModel': fallbackModel,
      if (additionalDirectories != null && additionalDirectories.isNotEmpty)
        'additionalDirectories': additionalDirectories,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments.map((a) => a.toJson()).toList(),
    });
  }

  void ccAbort(String sessionId) {
    _socket.send({'type': 'cc_abort', 'sessionId': sessionId});
  }

  /// Stop a running background task (agent teams).
  void ccStopTask({required String sessionId, required String taskId}) {
    _socket.send({
      'type': 'cc_stop_task',
      'sessionId': sessionId,
      'taskId': taskId,
    });
  }

  void ccRespondToPermission({
    required String sessionId,
    required String toolUseId,
    required String response,
    Map<String, dynamic>? updatedInput,
  }) {
    _socket.send({
      'type': 'cc_permission_response',
      'sessionId': sessionId,
      'toolUseId': toolUseId,
      'response': response,
      if (updatedInput != null) 'updatedInput': updatedInput,
    });
  }

  // ============================================================
  // Claude Code - Mid-session controls
  // ============================================================

  /// Change permission mode mid-session.
  Future<bool> ccSetPermissionMode({
    required String sessionId,
    required String mode,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_set_permission_mode',
      'sessionId': sessionId,
      'mode': mode,
      'requestId': requestId,
    });

    try {
      final response = await _waitFor(
        'cc_permission_mode_set',
        requestId: requestId,
      );
      final data = response['data'];
      if (data is Map<String, dynamic>) {
        return data['ok'] as bool? ?? false;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Change model mid-session.
  Future<bool> ccSetModel({required String sessionId, String? model}) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_set_model',
      'sessionId': sessionId,
      if (model != null) 'model': model,
      'requestId': requestId,
    });

    try {
      final response = await _waitFor('cc_model_set', requestId: requestId);
      final data = response['data'];
      if (data is Map<String, dynamic>) {
        return data['ok'] as bool? ?? false;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Dynamically set MCP servers mid-session.
  Future<Map<String, dynamic>?> ccSetMcpServers({
    required String sessionId,
    required Map<String, dynamic> servers,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cc_set_mcp_servers',
      'sessionId': sessionId,
      'servers': servers,
      'requestId': requestId,
    });

    try {
      final response = await _waitFor(
        'cc_mcp_servers_set',
        requestId: requestId,
      );
      final data = response['data'];
      if (data is Map<String, dynamic>) return data;
      if (data is Map) return data.cast<String, dynamic>();
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Reconnect a disconnected MCP server mid-session.
  void ccReconnectMcpServer({
    required String sessionId,
    required String serverName,
  }) {
    _socket.send({
      'type': 'cc_reconnect_mcp_server',
      'sessionId': sessionId,
      'serverName': serverName,
    });
  }

  /// Enable or disable an MCP server mid-session.
  void ccToggleMcpServer({
    required String sessionId,
    required String serverName,
    required bool enabled,
  }) {
    _socket.send({
      'type': 'cc_toggle_mcp_server',
      'sessionId': sessionId,
      'serverName': serverName,
      'enabled': enabled,
    });
  }
}
