import 'package:broski/agent/catalog/session_rows.dart';
import 'package:broski/contract/generated/contract.dart';

/// A working directory the sessions of a backend use: what the phone offers
/// as that backend's projects.
final class DirectorySummary {
  const DirectorySummary({
    required this.cwd,
    required this.sessions,
    required this.updatedAt,
  });

  factory DirectorySummary.fromJson(Object? json) {
    if (json case {
      'cwd': final String cwd,
      'sessions': final int sessions,
      'updatedAt': final int updatedAt,
    }) {
      return DirectorySummary(
        cwd: cwd,
        sessions: sessions,
        updatedAt: updatedAt,
      );
    }
    throw const FormatException('Not a DirectorySummary');
  }

  final String cwd;
  final int sessions;

  /// When the newest of its sessions was updated.
  final Timestamp updatedAt;

  Map<String, Object?> toJson() => {
    'cwd': cwd,
    'sessions': sessions,
    'updatedAt': updatedAt,
  };
}

/// The directories [rows] work in, the most recently used first (ties by
/// path); a row without a directory belongs to none.
List<DirectorySummary> directoriesOf(Iterable<SessionSummary> rows) {
  final byCwd = <String, ({int sessions, Timestamp updatedAt})>{};
  for (final row in sortedRows(rows)) {
    final cwd = row.cwd;
    if (cwd == null) continue;
    final held = byCwd[cwd];
    byCwd[cwd] = (
      sessions: (held?.sessions ?? 0) + 1,
      updatedAt: held?.updatedAt ?? row.updatedAt,
    );
  }
  return [
    for (final MapEntry(:key, :value) in byCwd.entries)
      DirectorySummary(
        cwd: key,
        sessions: value.sessions,
        updatedAt: value.updatedAt,
      ),
  ]..sort((a, b) {
    final byTime = b.updatedAt.compareTo(a.updatedAt);
    return byTime != 0 ? byTime : a.cwd.compareTo(b.cwd);
  });
}

/// [directories] with the activity [row] reports: its directory listed, and
/// as recent as the row.
List<DirectorySummary> withActivity(
  List<DirectorySummary> directories,
  SessionSummary row,
) {
  final cwd = row.cwd!;
  final held = directories
      .where((directory) => directory.cwd == cwd)
      .firstOrNull;
  final updated = DirectorySummary(
    cwd: cwd,
    sessions: held?.sessions ?? 1,
    updatedAt: held == null || row.updatedAt > held.updatedAt
        ? row.updatedAt
        : held.updatedAt,
  );
  return sortedDirectories([
    for (final directory in directories)
      if (directory.cwd != cwd) directory,
    updated,
  ]);
}

List<DirectorySummary> sortedDirectories(
  Iterable<DirectorySummary> directories,
) => directories.toList()
  ..sort((a, b) {
    final byTime = b.updatedAt.compareTo(a.updatedAt);
    return byTime != 0 ? byTime : a.cwd.compareTo(b.cwd);
  });
