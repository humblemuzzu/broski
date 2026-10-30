part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

/// The tool-call statuses that mean the tool has not reported a result yet.
const _unfinishedToolStatuses = {'running', 'pending'};

/// What a card shows for a tool the user stopped before it reported back.
const _stoppedToolOutput = 'Stopped';

/// Ends the running state on this phone without waiting for the bridge.
///
/// Stop has to work when the bridge cannot answer: the abort message may never arrive, and the events
/// that would end the turn with it. The next resync replaces this local view with what the Mac recorded.
extension ChatLocalCancel on ChatSessionNotifier {
  void cancelRunLocally() {
    _textDebounceTimer?.cancel();
    _textDebounceTimer = null;
    _runtimeProjectionTimer?.cancel();
    _runtimeProjectionTimer = null;
    _pendingProjectionTurn = null;

    for (final key in _runtimeChatTurns.keys.toList()) {
      final turn = _runtimeChatTurns[key]!;
      final stopped = turn.copyWith(
        isStreaming: false,
        tools: {
          for (final entry in turn.tools.entries)
            entry.key: stoppedToolCall(entry.value),
        },
      );
      _runtimeChatTurns[key] = stopped;
      _projectRuntimeTurn(stopped);
    }

    for (final id in _order) {
      final message = _messages[id];
      if (message == null) continue;
      if (message.toolCalls.any(isUnfinishedToolCall)) {
        _messages[id] = message.copyWith(
          toolCalls: [
            for (final tool in message.toolCalls) stoppedToolCall(tool),
          ],
        );
      }
    }

    markAllStreamingComplete();
    _emitMessages();
    state = state.copyWith(
      ccIsStreaming: false,
      cxIsStreaming: false,
      isCompacting: false,
    );
  }
}

bool isUnfinishedToolCall(ToolCall tool) =>
    _unfinishedToolStatuses.contains(tool.status);

/// [tool] as it stands once the user stopped the run: a tool that never reported a result is an error.
ToolCall stoppedToolCall(ToolCall tool) {
  if (!isUnfinishedToolCall(tool)) return tool;
  return tool.copyWith(
    status: 'error',
    output: tool.output ?? _stoppedToolOutput,
  );
}
