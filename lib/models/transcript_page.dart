/// One page of a chat transcript.
///
/// Pages arrive newest-last. [nextCursor] names the boundary the next, older page ends at, so a
/// cursor keeps meaning the same older messages when the session grows at the end. A reply without
/// `hasMore` is the whole transcript, which is what the bridge sends when it cannot page.
class TranscriptPage<T> {
  const TranscriptPage({
    required this.items,
    required this.hasMore,
    this.nextCursor,
    this.cursorUnknown = false,
  });

  final List<T> items;
  final bool hasMore;
  final String? nextCursor;

  /// The cursor asked for names no message of this session any more, so the page is the newest
  /// one instead of the one before it: the caller replaces its transcript rather than prepending.
  final bool cursorUnknown;

  bool get hasOlder => hasMore && nextCursor != null;

  TranscriptPage.complete(this.items)
    : hasMore = false,
      nextCursor = null,
      cursorUnknown = false;

  static TranscriptPage<T> fromResponse<T>(
    Map<String, dynamic> response,
    List<T> items,
  ) {
    final unknown = response['cursorUnknown'];
    final hasMore = response['hasMore'];
    if (hasMore is! bool) return TranscriptPage<T>.complete(items);
    final cursor = response['nextCursor'];
    return TranscriptPage<T>(
      items: items,
      hasMore: hasMore,
      nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
      cursorUnknown: unknown == true,
    );
  }
}

/// Keeps [older] in front of [existing], dropping older entries whose key already exists so a page
/// that overlaps the loaded window (or a live-streamed message) is not shown twice.
List<T> prependUnique<T>(
  List<T> older,
  List<T> existing,
  String Function(T item) key,
) {
  final seen = existing.map(key).toSet();
  final kept = <T>[];
  for (final item in older) {
    if (seen.add(key(item))) kept.add(item);
  }
  if (kept.isEmpty) return existing;
  return [...kept, ...existing];
}

/// Scroll offset that keeps the same message under the viewport after older ones were prepended.
double preservedScrollOffset({
  required double currentOffset,
  required double maxExtentBefore,
  required double maxExtentAfter,
}) {
  final added = maxExtentAfter - maxExtentBefore;
  return added > 0 ? currentOffset + added : currentOffset;
}
