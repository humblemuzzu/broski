/// How long ago [timestampMs] was, as a person says it.
String sessionTimeText(int timestampMs) {
  final at = DateTime.fromMillisecondsSinceEpoch(timestampMs);
  final diff = DateTime.now().difference(at);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return '${at.day}/${at.month}/${at.year}';
}

/// The name a person knows the directory [path] by: its last segment.
String sessionProjectName(String? path) {
  final parts = (path ?? '').split('/').where((part) => part.isNotEmpty);
  return parts.lastOrNull ?? 'Unknown';
}
