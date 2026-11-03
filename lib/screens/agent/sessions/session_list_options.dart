import 'package:broski/contract/generated/contract.dart';

/// How the rows loaded so far are ordered. The bridge's own order is newest
/// updated first, ties broken by id (contract §11.1); the others reorder what
/// has been read, they do not ask the bridge again.
enum SessionSort {
  recent('Recently updated', 'Updated'),
  created('Newest first', 'Created'),
  title('Title', 'Title');

  const SessionSort(this.label, this.shortLabel);

  final String label;

  /// The same order where only a chip has room for it.
  final String shortLabel;
}

/// What the person chose to see of the rows loaded: words to find, the order,
/// one directory, rows grouped under their directory.
final class SessionListOptions {
  const SessionListOptions({
    this.search = '',
    this.sort = SessionSort.recent,
    this.directory,
    this.byDirectory = false,
  });

  final String search;
  final SessionSort sort;
  final String? directory;
  final bool byDirectory;

  /// Whether anything narrows the list.
  bool get filtering => search.trim().isNotEmpty || directory != null;

  SessionListOptions copyWith({
    String? search,
    SessionSort? sort,
    bool? byDirectory,
  }) => SessionListOptions(
    search: search ?? this.search,
    sort: sort ?? this.sort,
    directory: directory,
    byDirectory: byDirectory ?? this.byDirectory,
  );

  SessionListOptions inDirectory(String? directory) => SessionListOptions(
    search: search,
    sort: sort,
    directory: directory,
    byDirectory: byDirectory,
  );
}

/// [rows] narrowed and ordered by [options]. A row matches when every word
/// searched is in its title, directory or source, whatever the case.
List<SessionSummary> visibleSessions(
  List<SessionSummary> rows,
  SessionListOptions options,
) {
  final words = options.search.toLowerCase().split(RegExp(r'\s+'))
    ..removeWhere((word) => word.isEmpty);
  final matching = [
    for (final row in rows)
      if ((options.directory == null || row.cwd == options.directory) &&
          words.every(_haystack(row).contains))
        row,
  ];
  return switch (options.sort) {
    SessionSort.recent => matching,
    SessionSort.created => _stable(
      matching,
      (a, b) => (b.createdAt ?? -1).compareTo(a.createdAt ?? -1),
    ),
    SessionSort.title => _stable(matching, _byTitle),
  };
}

/// The directories [rows] work in, the one with the newest row first.
List<String> directoriesOf(List<SessionSummary> rows) {
  final newest = <String, int>{};
  for (final row in rows) {
    if (row.cwd case final cwd?) {
      final seen = newest[cwd];
      if (seen == null || row.updatedAt > seen) newest[cwd] = row.updatedAt;
    }
  }
  return newest.keys.toList()..sort((a, b) => newest[b]!.compareTo(newest[a]!));
}

/// [rows] in sections by directory, in the order each directory first
/// appears; rows that name none share one section with a null directory.
List<({String? directory, List<SessionSummary> rows})> byDirectory(
  List<SessionSummary> rows,
) {
  final sections = <String?, List<SessionSummary>>{};
  for (final row in rows) {
    sections.putIfAbsent(row.cwd, () => []).add(row);
  }
  return [
    for (final MapEntry(:key, :value) in sections.entries)
      (directory: key, rows: value),
  ];
}

String _haystack(SessionSummary row) =>
    [row.title?.text, row.cwd, row.source].nonNulls.join('\n').toLowerCase();

int _byTitle(SessionSummary a, SessionSummary b) {
  final left = a.title?.text.toLowerCase();
  final right = b.title?.text.toLowerCase();
  if (left == null || right == null) {
    return left == right ? 0 : (left == null ? 1 : -1);
  }
  return left.compareTo(right);
}

List<SessionSummary> _stable(
  List<SessionSummary> rows,
  int Function(SessionSummary a, SessionSummary b) compare,
) {
  final indexed = rows.indexed.toList()
    ..sort((a, b) {
      final order = compare(a.$2, b.$2);
      return order != 0 ? order : a.$1.compareTo(b.$1);
    });
  return [for (final (_, row) in indexed) row];
}
