import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/contract/generated/contract.dart';

/// Prompts a replaced session hands to the session that goes on under a new
/// id (`session_replaced`, contract §7), so nothing the person typed is lost
/// with the old one. Nothing is sent on their behalf: the bridge
/// de-duplicates by session, so a prompt whose fate is unknown waits for the
/// person to send it again, edit it or drop it.
final class PromptHandoff {
  /// Sessions whose prompts wait to be taken; past it the oldest go.
  static const limit = 32;

  final Map<SessionRef, List<OutgoingPrompt>> _waiting = {};

  void leave(SessionRef next, List<OutgoingPrompt> prompts) {
    if (prompts.isEmpty) return;
    _waiting.remove(next);
    if (_waiting.length >= limit) _waiting.remove(_waiting.keys.first);
    _waiting[next] = [for (final prompt in prompts) _carried(prompt)];
  }

  List<OutgoingPrompt> take(SessionRef session) =>
      _waiting.remove(session) ?? const [];
}

OutgoingPrompt _carried(OutgoingPrompt prompt) => switch (prompt.delivery) {
  PromptSending() || PromptUnconfirmed() => prompt.delivered(
    const PromptUnconfirmed(
      'The conversation moved to a new session before this was confirmed',
      resending: false,
    ),
  ),
  PromptTaken() || PromptNotSent() => prompt,
};
