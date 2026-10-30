part of '../chat_provider.dart';

/// Prepending an older page of a transcript in front of the loaded window.
///
/// Older pages are inserted rather than re-hydrated: a re-hydrate would drop messages that arrived
/// from the stream while the page was in flight, and a live message has no place in the raw list.
extension TranscriptPrepend on ChatSessionNotifier {
  void prependClaudeCodeTranscript(
    List<Map<String, dynamic>> items, {
    required String sessionId,
  }) {
    if (!ownsTranscript(sessionId) || items.isEmpty) return;
    final additions = <ChatMessage>[];
    for (final item in items) {
      final message = ccTranscriptMessage(item, sessionId);
      if (message == null || _messages.containsKey(message.id)) continue;
      additions.add(message);
    }
    _prependMessages(additions);
  }

  void prependCodexTranscript(
    List<CodexTranscriptMessage> items, {
    required String threadId,
  }) {
    if (!ownsTranscript(threadId) || items.isEmpty) return;
    final additions = <ChatMessage>[];
    for (final item in items) {
      if (item.id.isEmpty || _messages.containsKey(item.id)) continue;
      additions.add(cxTranscriptMessage(item, threadId));
    }
    _prependMessages(additions);
  }

  /// Inserts [messages] in front of the loaded window, dropping any whose id the window already
  /// holds or that repeats inside the page. A duplicated id would render one key twice.
  void _prependMessages(List<ChatMessage> messages) {
    if (messages.isEmpty) return;
    final window = _order
        .map((id) => _messages[id])
        .whereType<ChatMessage>()
        .toList(growable: false);
    final merged = prependUnique(messages, window, (message) => message.id);
    if (identical(merged, window)) return;
    _suppressEmit = true;
    _messages
      ..clear()
      ..addEntries(merged.map((message) => MapEntry(message.id, message)));
    _order
      ..clear()
      ..addAll(merged.map((message) => message.id));
    _suppressEmit = false;
    _emitMessages();
  }
}
