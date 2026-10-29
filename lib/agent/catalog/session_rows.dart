import 'package:broski/contract/generated/contract.dart';

/// Whether a row the catalog announced belongs in a list asked with [query]:
/// the same archive state and directory, and, for a list of one session's
/// children, that parent; a top-level list leaves out subagents, which the
/// app reaches through their parent (contract §11.1). The bridge answers a
/// list in its canonical form of the directory asked, so a row the list
/// already [held] keeps its place whatever its directory reads.
bool belongsTo(SessionSummary row, SessionQuery query, {required bool held}) {
  if (row.archived != query.archived) return false;
  final cwd = query.cwd;
  if (!held && cwd != null && row.cwd != cwd) return false;
  final parent = query.parent;
  if (parent != null) return row.parent?.session == parent;
  return row.parent?.kind != ParentKind.subagent;
}

/// [rows] with [row] in its place, newest updated first, replacing the row of
/// the same session; ties keep a stable order by session id.
List<SessionSummary> withRow(List<SessionSummary> rows, SessionSummary row) =>
    sortedRows([
      for (final held in rows)
        if (held.session != row.session) held,
      row,
    ]);

List<SessionSummary> sortedRows(Iterable<SessionSummary> rows) =>
    rows.toList()..sort((a, b) {
      final byTime = b.updatedAt.compareTo(a.updatedAt);
      return byTime != 0
          ? byTime
          : a.session.sessionId.compareTo(b.session.sessionId);
    });

/// [rows] followed by [page], each session once: on a list that changes
/// between pages a row can move, and the newest copy of it wins.
List<SessionSummary> withPage(
  List<SessionSummary> rows,
  List<SessionSummary> page,
) {
  final paged = {for (final row in page) row.session};
  return [
    for (final held in rows)
      if (!paged.contains(held.session)) held,
    ...page,
  ];
}
