part of '../chat_provider.dart';

// ignore_for_file: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member

extension CachedHydration on ChatSessionNotifier {
  /// Replaces the transcript with messages read back from the offline cache.
  void hydrateCached(List<ChatMessage> messages) {
    _messages.clear();
    _order.clear();
    state = state.copyWith(
      messages: const [],
      permissions: const [],
      sessionDiffs: const [],
    );
    for (final message in messages) {
      _addMessage(message);
    }
  }
}
