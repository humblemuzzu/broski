import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/turn_notification_policy.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether a chat screen is on screen. Plain state rather than a notifier: it changes while screens are
/// being built and torn down, and only a notification decision ever reads it.
final class ChatPresence {
  var _openChats = 0;

  bool get isChatOpen => _openChats > 0;

  void opened() => _openChats++;

  void closed() {
    if (_openChats > 0) _openChats--;
  }
}

final chatPresenceProvider = Provider<ChatPresence>((ref) => ChatPresence());

/// Whether a notification for [finishedSessionId] finishing should be shown right now.
bool shouldNotifyForFinishedSession(Ref ref, String finishedSessionId) {
  final lifecycle = WidgetsBinding.instance.lifecycleState;
  return shouldNotifyTurnFinished(
    appInForeground:
        lifecycle == null || lifecycle == AppLifecycleState.resumed,
    chatOpen: ref.read(chatPresenceProvider).isChatOpen,
    openChatSessionId: ref.read(chatSessionProvider).effectiveSessionId,
    finishedSessionId: finishedSessionId,
  );
}
