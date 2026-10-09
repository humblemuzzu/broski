part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// Pi Durable session setup, hydration and state projection.
///
/// Mirrors `PiStreamHandler` so the two Pi flavours share the reducers, the
/// transcript hydration path and the permission flow, and differ only in the
/// bridge surface they talk to.
extension PiDurableStreamHandler on ChatSessionNotifier {
  void setPiDurableSession({
    required String sessionId,
    required String cwd,
    String? model,
    PiThinkingLevel? thinkingLevel,
  }) {
    _messages.clear();
    _order.clear();
    _rolesByMessageId.clear();
    _pendingLocalUserTextByMessageId.clear();
    _localAuthoredUserMessageIds.clear();
    _pendingTextBuffers.clear();
    _runtimeChatTurns.clear();
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;
    _resetCCState();
    state = PiDurableChatState(
      projectPath: cwd,
      pdSessionId: sessionId.isEmpty ? null : sessionId,
      pdCwd: cwd,
      pdModel: model,
      pdThinkingLevel: thinkingLevel,
    );
    if (sessionId.isNotEmpty) {
      _bridge.setView(
        sessionId: sessionId,
        agent: 'pi-durable',
        lastRuntimeSeq: 0,
      );
    }
  }

  void setPiDurableStreaming(bool streaming) {
    final current = state;
    if (current is! PiDurableChatState) return;
    state = current.copyWith(pdIsStreaming: streaming);
  }

  void setPiDurableModel(String? model, {PiThinkingLevel? thinkingLevel}) {
    final current = state;
    if (current is! PiDurableChatState) return;
    state = current.copyWith(
      pdModel: model,
      pdThinkingLevel: thinkingLevel ?? current.pdThinkingLevel,
    );
  }

  void setPiDurableResumeNotice(String? notice) {
    final current = state;
    if (current is! PiDurableChatState) return;
    state = current.copyWith(pdResumeNotice: notice);
  }

  /// Hydrates the durable transcript through the Pi hydration path: the
  /// `pd_transcript` message shapes are the `pi_session_messages` shapes.
  void hydratePiDurableTranscript(List<Map<String, dynamic>> items) {
    hydratePiTranscript(items, idPrefix: 'pd');
  }

  /// A `resumed` backend_event is the only signal that the Mac picked
  /// interrupted work back up on attach, so it becomes a dismissible banner.
  void _handlePiDurableBackendEvent(RuntimeBackendEvent event) {
    if (event.kind != 'resumed') return;
    setPiDurableResumeNotice(
      piDurableResumeNoticeText(event.backend, event.payload),
    );
  }

  /// Optimistic user message whose id is also the `pd_chat` requestId, so the
  /// bridge's exactly-once key survives a reconnect resend.
  String appendPiDurableUserMessage(
    String content, {
    required String messageId,
  }) {
    final sessionId = state.pdSessionId ?? '';
    _addMessage(
      ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: MessageRole.user,
        createdAt: DateTime.now(),
        text: content,
        metadata: const {'deliveryState': 'pending'},
      ),
    );
    return messageId;
  }

  /// Projects a runtime state/turn onto the durable chat state. Called from the
  /// shared ingest reducer, which stays backend-agnostic.
  void applyPiDurableRuntimeState({
    required RuntimeState? runtimeState,
    required RuntimeChatTurnState turn,
  }) {
    final current = state;
    if (current is! PiDurableChatState) return;
    final runtimeModel = runtimeState?.model;
    state = current.copyWith(
      sessionStatus: _runtimeSessionStatus(runtimeState, turn),
      pdSessionId: (current.pdSessionId ?? '').isEmpty
          ? turn.sessionId
          : current.pdSessionId,
      pdCwd: (current.pdCwd ?? '').isEmpty ? turn.cwd : current.pdCwd,
      pdModel: runtimeModel?.label ?? runtimeModel?.id ?? current.pdModel,
      pdIsStreaming: turn.isStreaming,
      isCompacting: runtimeState?.isCompacting ?? current.isCompacting,
    );
  }
}
