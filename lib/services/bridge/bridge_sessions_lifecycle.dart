part of '../bridge_service.dart';

/// Session lifecycle: fork, revert, share, summarize, init.
/// Extracted from bridge_service.dart to reduce file size.
extension BridgeServiceSessionsLifecycle on BridgeService {
  // ============================================================
  // Fork
  // ============================================================

  Future<SessionSummary> forkSession(
    String sessionId, {
    String? messageId,
    String? projectPath,
  }) {
    final dedupeKey = 'fork_session:$sessionId:${messageId ?? 'end'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _forkSessionInternal(
        sessionId,
        messageId: messageId,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _forkSessionInternal(
    String sessionId, {
    String? messageId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'fork_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (messageId != null) 'messageId': messageId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_forked', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<List<SessionSummary>> sessionChildren(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'session_children',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_children', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data
        .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  // ============================================================
  // Revert / Unrevert
  // ============================================================

  Future<SessionSummary> revertMessage(
    String sessionId, {
    required String messageId,
    String? partId,
    String? projectPath,
  }) {
    final dedupeKey = 'revert:$sessionId:$messageId:${partId ?? 'all'}';
    return _deduplicatedRequest(
      dedupeKey,
      () => _revertMessageInternal(
        sessionId,
        messageId: messageId,
        partId: partId,
        projectPath: projectPath,
      ),
    );
  }

  Future<SessionSummary> _revertMessageInternal(
    String sessionId, {
    required String messageId,
    String? partId,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'revert_message',
      'sessionId': sessionId,
      'messageId': messageId,
      'requestId': requestId,
      if (partId != null) 'partId': partId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('message_reverted', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<SessionSummary> unrevertSession(
    String sessionId, {
    String? projectPath,
  }) {
    final dedupeKey = 'unrevert:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _unrevertSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _unrevertSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unrevert_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_unreverted', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Share / Unshare
  // ============================================================

  Future<SessionSummary> shareSession(
    String sessionId, {
    String? projectPath,
  }) {
    final dedupeKey = 'share:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _shareSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _shareSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'share_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_shared', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  Future<SessionSummary> unshareSession(
    String sessionId, {
    String? projectPath,
  }) {
    final dedupeKey = 'unshare:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _unshareSessionInternal(sessionId, projectPath: projectPath),
    );
  }

  Future<SessionSummary> _unshareSessionInternal(
    String sessionId, {
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'unshare_session',
      'sessionId': sessionId,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor('session_unshared', requestId: requestId);
    return SessionSummary.fromJson(response['data'] as Map<String, dynamic>);
  }

  // ============================================================
  // Summarize (Compact)
  // ============================================================

  Future<bool> summarizeSession(
    String sessionId, {
    required String providerID,
    required String modelID,
    String? projectPath,
    bool? auto,
  }) {
    final dedupeKey = 'summarize:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _summarizeSessionInternal(
        sessionId,
        providerID: providerID,
        modelID: modelID,
        projectPath: projectPath,
        auto: auto,
      ),
    );
  }

  Future<bool> _summarizeSessionInternal(
    String sessionId, {
    required String providerID,
    required String modelID,
    String? projectPath,
    bool? auto,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'summarize_session',
      'sessionId': sessionId,
      'providerID': providerID,
      'modelID': modelID,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      if (auto != null) 'auto': auto,
    });
    final response = await _waitFor('session_summarized', requestId: requestId);
    return response['data'] as bool? ?? false;
  }

  // ============================================================
  // Session Init (Create AGENTS.md)
  // ============================================================

  Future<bool> initSession({
    required String sessionId,
    required String providerID,
    required String modelID,
    required String messageID,
    String? projectPath,
  }) {
    final dedupeKey = 'init_session:$sessionId';
    return _deduplicatedRequest(
      dedupeKey,
      () => _initSessionInternal(
        sessionId: sessionId,
        providerID: providerID,
        modelID: modelID,
        messageID: messageID,
        projectPath: projectPath,
      ),
    );
  }

  Future<bool> _initSessionInternal({
    required String sessionId,
    required String providerID,
    required String modelID,
    required String messageID,
    String? projectPath,
  }) async {
    final requestId = _generateRequestId();
    _socket.send({
      'type': 'init_session',
      'sessionId': sessionId,
      'providerID': providerID,
      'modelID': modelID,
      'messageID': messageID,
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
    });
    final response = await _waitFor(
      'session_initialized',
      requestId: requestId,
    );
    return response['data'] as bool? ?? false;
  }
}
