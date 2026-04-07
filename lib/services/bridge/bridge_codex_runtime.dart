part of '../bridge_service.dart';

extension BridgeServiceCodexRuntime on BridgeService {
  Future<List<Map<String, dynamic>>> cxListMcpServerStatus({
    String? cursor,
    int limit = 200,
    String? detail, // "full" (default) or "toolsAndAuthOnly" (faster)
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_mcp_status_list',
      'requestId': requestId,
      'cursor': cursor,
      'limit': limit,
      if (detail != null) 'detail': detail,
    });
    final response = await _waitFor(
      'cx_mcp_status',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'] as List<dynamic>? ?? [];
    return data.whereType<Map<String, dynamic>>().toList();
  }

  /// Hot reload MCP server config (Codex SDK feature)
  /// Reloads MCP config from disk and queues refresh for loaded threads.
  Future<void> cxMcpReload() async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'cx_mcp_reload', 'requestId': requestId});
    await _waitFor(
      'cx_mcp_reloaded',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
  }

  Future<Map<String, dynamic>> cxStartReview({
    String? threadId,
    String? cwd,
    String delivery = 'inline',
    Map<String, dynamic>? target,
    String? model,
    String? approvalPolicy,
    String? sandbox,
    Map<String, dynamic>? sandboxPolicy,
    Map<String, dynamic>? config,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'cx_review_start',
      'requestId': requestId,
      if (threadId != null) 'threadId': threadId,
      if (cwd != null) 'cwd': cwd,
      'delivery': delivery,
      if (target != null) 'target': target,
      if (model != null) 'model': model,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
      if (sandboxPolicy != null) 'sandboxPolicy': sandboxPolicy,
      if (config != null) 'config': config,
    });
    final response = await _waitFor(
      'cx_review_started',
      requestId: requestId,
      timeoutSeconds: _codexTimeoutSeconds,
    );
    final data = response['data'];
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return data.cast<String, dynamic>();
    return const {};
  }

  void cxChat({
    String? threadId,
    required String cwd,
    required String prompt,
    String? model,
    String? effort,
    String? summary,
    String? approvalPolicy,
    String? sandbox,
    Map<String, dynamic>? sandboxPolicy,
    Map<String, dynamic>? config,
    List<FileAttachment>? fileAttachments,
    String? collaborationMode, // SDK ModeKind: 'plan' | 'default'
    String? personality, // SDK Personality: 'none' | 'friendly' | 'pragmatic'
    String? serviceTier, // SDK ServiceTier: 'fast' | 'flex'
    List<Map<String, String>>? skillMentions,
    List<Map<String, String>>? fileMentions,
    Map<String, dynamic>? outputSchema,
  }) {
    _socket.send({
      'type': 'cx_chat',
      if (threadId != null) 'threadId': threadId,
      'cwd': cwd,
      'prompt': prompt,
      if (model != null) 'model': model,
      if (effort != null) 'effort': effort,
      if (summary != null) 'summary': summary,
      if (approvalPolicy != null) 'approvalPolicy': approvalPolicy,
      if (sandbox != null) 'sandbox': sandbox,
      if (sandboxPolicy != null) 'sandboxPolicy': sandboxPolicy,
      if (config != null) 'config': config,
      if (fileAttachments != null)
        'fileAttachments': fileAttachments.map((a) => a.toJson()).toList(),
      if (collaborationMode != null) 'collaborationMode': collaborationMode,
      if (personality != null) 'personality': personality,
      if (serviceTier != null) 'serviceTier': serviceTier,
      if (skillMentions != null && skillMentions.isNotEmpty)
        'skillMentions': skillMentions,
      if (fileMentions != null && fileMentions.isNotEmpty)
        'fileMentions': fileMentions,
      if (outputSchema != null) 'outputSchema': outputSchema,
    });
  }

  void cxAbort({required String threadId, String? turnId}) {
    _socket.send({
      'type': 'cx_abort',
      'threadId': threadId,
      if (turnId != null) 'turnId': turnId,
    });
  }

  void cxRespondToPermission({
    required String requestId,
    required String response,
    Object? execpolicyAmendment,
    Map<String, dynamic>? networkPolicyAmendment,
  }) {
    _socket.send({
      'type': 'cx_permission_response',
      'requestId': requestId,
      'response': response,
      if (execpolicyAmendment != null)
        'execpolicyAmendment': execpolicyAmendment,
      if (networkPolicyAmendment != null)
        'networkPolicyAmendment': networkPolicyAmendment,
    });
  }

  /// Respond to a Codex request_user_input event (SDK v0.87.0+).
  ///
  /// Protocol shape: `{ answers: { questionId: { answers: string[] } } }`.
  void cxRespondToUserInput({
    required String requestId,
    required Map<String, Map<String, dynamic>> answers,
  }) {
    _socket.send({
      'type': 'cx_user_input_response',
      'requestId': requestId,
      'answers': answers,
    });
  }
}
