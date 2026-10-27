/// Rows one session list page asks for; the bridge clamps its own maximum.
const int kSessionPageLimit = 100;

/// One page of a session list: the rows, and the cursor the page after them starts at.
class SessionPage<T> {
  const SessionPage({
    required this.items,
    required this.hasMore,
    this.nextCursor,
  });

  final List<T> items;
  final bool hasMore;
  final String? nextCursor;

  bool get hasAnotherPage => hasMore && nextCursor != null;

  SessionPage.complete(this.items) : hasMore = false, nextCursor = null;

  /// A reply that names no `hasMore` is a whole list, exactly as before paging.
  static SessionPage<T> fromResponse<T>(
    Map<String, dynamic> response,
    List<T> Function(List<dynamic> rows) parse,
  ) {
    final rows = response['data'] as List<dynamic>? ?? const [];
    final hasMore = response['hasMore'];
    if (hasMore is! bool) {
      return SessionPage<T>.complete(parse(rows));
    }
    final cursor = response['nextCursor'];
    return SessionPage<T>(
      items: parse(rows),
      hasMore: hasMore,
      nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
    );
  }
}
