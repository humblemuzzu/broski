import 'dart:convert';

import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/catalog/directory_summary.dart';
import 'package:broski/contract/generated/contract.dart';

/// A transcript as the phone saved it: the newest finished items, oldest
/// first.
final class CachedHistory {
  const CachedHistory(this.items, this.stability);

  final List<TranscriptItem> items;
  final IdStability stability;
}

/// What the cache keeps, each kind under its own name.
extension CachedKinds on AgentCache {
  static const maxRows = 200;
  static const maxItems = 120;

  Future<Saved<List<BackendDescriptor>>?> backends() => read(
    'backends',
    (data) => [
      for (final item in data! as List<Object?>)
        BackendDescriptor.fromJson(item! as Map<String, Object?>),
    ],
  );

  Future<void> saveBackends(List<BackendDescriptor> backends) =>
      write('backends', [for (final listed in backends) listed.toJson()]);

  Future<Saved<List<SessionSummary>>?> sessions(
    BackendId id,
    SessionQuery query,
  ) => read(
    _sessionsName(id, query),
    (data) => [
      for (final item in data! as List<Object?>)
        SessionSummary.fromJson(item! as Map<String, Object?>),
    ],
  );

  Future<void> saveSessions(
    BackendId id,
    SessionQuery query,
    List<SessionSummary> rows,
  ) => write(_sessionsName(id, query), [
    for (final row in rows.take(maxRows)) row.toJson(),
  ]);

  Future<Saved<CachedHistory>?> history(SessionRef session) =>
      read(_historyName(session), (data) {
        final map = data! as Map<String, Object?>;
        return CachedHistory([
          for (final item in map['items']! as List<Object?>)
            TranscriptItem.fromJson(item! as Map<String, Object?>),
        ], IdStability.fromJson(map['stability']! as String));
      });

  /// The newest of [items] (oldest first) that fit the entry bound.
  Future<void> saveHistory(
    SessionRef session,
    List<TranscriptItem> items,
    IdStability stability,
  ) {
    var kept = items.length > maxItems
        ? items.sublist(items.length - maxItems)
        : items;
    String encode() => jsonEncode([for (final item in kept) item.toJson()]);
    while (kept.length > 1 &&
        encode().length > AgentCache.maxEntryChars - 1024) {
      kept = kept.sublist(kept.length ~/ 4 + 1);
    }
    return write(_historyName(session), {
      'items': [for (final item in kept) item.toJson()],
      'stability': stability.toJson(),
    });
  }

  Future<Saved<List<DirectorySummary>>?> directories(BackendId id) => read(
    'directories:${id.wire}',
    (data) => [
      for (final item in data! as List<Object?>)
        DirectorySummary.fromJson(item),
    ],
  );

  Future<void> saveDirectories(
    BackendId id,
    List<DirectorySummary> directories,
  ) => write('directories:${id.wire}', [
    for (final directory in directories) directory.toJson(),
  ]);

  String _sessionsName(BackendId id, SessionQuery query) =>
      'sessions:${id.wire}:${jsonEncode(query.toJson())}';

  String _historyName(SessionRef session) =>
      'history:${jsonEncode(session.toJson())}';
}
