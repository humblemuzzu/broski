part of '../bridge_service.dart';

/// Pi Durable bridge surface: crash-safe sessions owned by the Mac.
///
/// Request payloads come from `buildPiDurable*` in
/// `models/pi_durable/pi_durable_payloads.dart` so the wire shapes are asserted
/// in tests without a socket.
extension BridgeServicePiDurable on BridgeService {
  /// `pd_create_session` → the new session, or null when the bridge refused
  /// (unknown model, bad cwd).
  Future<RuntimeSessionSummary?> pdCreateSession({
    required String cwd,
    String? provider,
    String? modelId,
    String? thinkingLevel,
    String? title,
  }) async {
    final requestId = _generateRequestId();
    final payload = buildPiDurableCreateSession(
      cwd: cwd,
      requestId: requestId,
      provider: provider,
      modelId: modelId,
      thinkingLevel: thinkingLevel,
      title: title,
    );
    _socket.send(payload);
    final response = await _waitFor('pd_session_created', requestId: requestId);
    final data = response['data'];
    if (data is! Map) return null;
    return RuntimeSessionSummary.fromJson(data.cast<String, dynamic>());
  }

  /// `pd_chat` → the submission id, or null if the bridge rejected the send.
  ///
  /// [requestId] is the exactly-once key: pass the optimistic message id so a
  /// retry after a reconnect cannot append the same prompt twice. [steer]
  /// queues the prompt into the running turn instead of starting a new one.
  Future<int?> pdChat({
    required String sessionId,
    required String content,
    required String requestId,
    bool steer = false,
  }) async {
    _socket.send(
      buildPiDurableChat(
        sessionId: sessionId,
        content: content,
        requestId: requestId,
        steer: steer,
      ),
    );
    final response = await _waitFor('pd_chat_accepted', requestId: requestId);
    final data = response['data'];
    if (data is! Map) return null;
    return (data['submissionId'] as num?)?.toInt();
  }

  /// `pd_get_transcript` → the newest committed page, oldest first.
  ///
  /// Opening a durable session resumes interrupted work on the Mac, so this is
  /// called when the chat opens rather than polled.
  Future<PiDurableTranscriptPage> pdGetTranscript({
    required String sessionId,
    int? limit,
    Map<String, dynamic>? cursor,
  }) async {
    final requestId = _generateRequestId();
    _socket.send(
      buildPiDurableGetTranscript(
        sessionId: sessionId,
        requestId: requestId,
        limit: limit,
        cursor: cursor,
      ),
    );
    final response = await _waitFor('pd_transcript', requestId: requestId);
    final data = response['data'];
    if (data is! Map) return PiDurableTranscriptPage.empty;
    return PiDurableTranscriptPage.fromJson(data.cast<String, dynamic>());
  }

  /// `pd_permission_response` → whether the bridge accepted the decision.
  ///
  /// [requestId] is the permission request id from the runtime event
  /// (`<sessionId>:<toolCallId>`), not a freshly generated one: the bridge uses
  /// it to find the pending prompt and echoes it on `pd_permission_resolved`.
  Future<bool> pdPermissionResponse({
    required String sessionId,
    required String requestId,
    required String response,
    String? reason,
  }) async {
    final payload = buildPiDurablePermissionResponse(
      sessionId: sessionId,
      requestId: requestId,
      response: response,
      reason: reason,
    );
    if (payload == null) return false;
    _socket.send(payload);
    final resolved = await _waitFor(
      'pd_permission_resolved',
      requestId: requestId,
    );
    return resolved['data'] == true;
  }
}
