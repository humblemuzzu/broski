import 'package:broski/providers/chat_provider.dart';

/// Whether the agent of this chat is still working.
///
/// A run is also still going while the newest message holds a tool that has not reported back, even when
/// the stream says it ended: that is the state a lost `tool_finished` leaves behind, and the user needs
/// Stop to get out of it.
bool chatIsRunning(ChatSessionState state) {
  if (state.sessionStatus.isBusy || state.sessionStatus.isRetry) return true;
  if (state.isCompacting) return true;
  if (state.ccIsStreaming) return true;
  final messages = state.messages;
  return messages.isNotEmpty &&
      messages.last.toolCalls.any(isUnfinishedToolCall);
}
