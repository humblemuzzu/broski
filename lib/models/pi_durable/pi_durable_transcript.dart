/// One page of a durable transcript: the newest `limit` committed messages,
/// oldest first, plus the cursor that pages further back.
class PiDurableTranscriptPage {
  final List<Map<String, dynamic>> messages;
  final Map<String, dynamic>? nextCursor;

  const PiDurableTranscriptPage({required this.messages, this.nextCursor});

  static const empty = PiDurableTranscriptPage(messages: []);

  factory PiDurableTranscriptPage.fromJson(Map<String, dynamic> json) {
    final raw = json['messages'];
    final cursor = json['nextCursor'];
    return PiDurableTranscriptPage(
      messages: raw is List
          ? raw.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
          : const [],
      nextCursor: cursor is Map ? cursor.cast<String, dynamic>() : null,
    );
  }

  bool get hasMore => nextCursor != null;
}
