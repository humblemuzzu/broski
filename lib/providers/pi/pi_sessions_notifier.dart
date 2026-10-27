import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/session_page.dart';
import 'package:broski/providers/sessions/runtime_session_delta_handler.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/utils/project_path_match.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The Pi session list: one page at a time, with the rows already shown kept current by the
/// bridge's single-session deltas instead of by re-reading the list.
class PiSessionsNotifier
    extends StateNotifier<AsyncValue<List<PiSessionInfo>>> {
  PiSessionsNotifier({
    required PiBridgeService bridge,
    required StorageService storage,
    required Stream<Map<String, dynamic>> deltas,
    required bool isOffline,
    required this.projectPath,
  }) : _bridge = bridge,
       _storage = storage,
       _isOffline = isOffline,
       super(const AsyncValue.loading()) {
    _deltaSub = deltas.listen(_handleDelta);
  }

  final PiBridgeService _bridge;
  final StorageService _storage;
  final bool _isOffline;
  final String? projectPath;

  late final StreamSubscription<Map<String, dynamic>> _deltaSub;

  @override
  void dispose() {
    _deltaSub.cancel();
    super.dispose();
  }

  void _handleDelta(Map<String, dynamic> message) {
    switch (runtimeSessionDeltaFromMessage(message)) {
      case RuntimeSessionUpserted(:final session):
        applyUpsert(session);
      case RuntimeSessionRemoved(:final sessionId):
        applyRemoval(sessionId);
      case null:
        break;
    }
  }

  String? _nextCursor;
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _loadMoreFailed = false;

  bool get hasMore => _hasMore;
  bool get isLoadingMore => _loadingMore;

  /// True after a page that did not arrive: the list keeps its rows and the footer offers a retry.
  bool get loadMoreFailed => _loadMoreFailed;

  Future<void> load() async {
    if (_isOffline) {
      _hasMore = false;
      _nextCursor = null;
      state = AsyncValue.data(await _storage.getCachedPiSessions());
      return;
    }
    try {
      final page = await _bridge.listSessionsPage(
        projectPath: projectPath,
        limit: kSessionPageLimit,
      );
      _nextCursor = page.nextCursor;
      _hasMore = page.hasAnotherPage;
      _loadMoreFailed = false;
      if (projectPath == null && page.items.isNotEmpty) {
        await _storage.cachePiSessions(page.items);
      }
      state = AsyncValue.data(page.items);
    } catch (error, stackTrace) {
      final cached = projectPath == null
          ? await _storage.getCachedPiSessions()
          : const <PiSessionInfo>[];
      state = cached.isNotEmpty
          ? AsyncValue.data(cached)
          : AsyncValue.error(error, stackTrace);
    }
  }

  Future<void> refresh() async {
    if (!_isOffline && state.hasValue) {
      state = const AsyncValue.loading();
    }
    await load();
  }

  Future<void> loadMore() async {
    final cursor = _nextCursor;
    if (_loadingMore || cursor == null || !_hasMore || _isOffline) return;
    _loadingMore = true;
    _loadMoreFailed = false;
    try {
      final page = await _bridge.listSessionsPage(
        projectPath: projectPath,
        limit: kSessionPageLimit,
        before: cursor,
      );
      _nextCursor = page.nextCursor;
      _hasMore = page.hasAnotherPage;
      final existing = state.valueOrNull ?? const <PiSessionInfo>[];
      final known = existing.map((session) => session.id).toSet();
      state = AsyncValue.data([
        ...existing,
        ...page.items.where((session) => known.add(session.id)),
      ]);
    } catch (_) {
      _loadMoreFailed = true;
    } finally {
      _loadingMore = false;
    }
  }

  /// A row from `runtime_session_updated`: replace it, or add it where its modified time belongs.
  void applyUpsert(RuntimeSessionSummary summary) {
    final rows = state.valueOrNull;
    if (rows == null || summary.backend != AgentType.pi) return;
    if (!projectPathMatches(summary.cwd, projectPath)) return;

    final row = piSessionInfoFromSummary(summary);
    final next = [...rows];
    final at = next.indexWhere((session) => session.id == row.id);
    if (at >= 0) {
      next[at] = row;
    } else {
      next.add(row);
    }
    next.sort((a, b) => b.modified.compareTo(a.modified));
    state = AsyncValue.data(next);
  }

  void applyRemoval(String sessionId) {
    final rows = state.valueOrNull;
    if (rows == null) return;
    final next = rows.where((session) => session.id != sessionId).toList();
    if (next.length != rows.length) state = AsyncValue.data(next);
  }
}

/// A deltas row carries what a list row shows; the rest of a Pi session summary is the list's.
PiSessionInfo piSessionInfoFromSummary(RuntimeSessionSummary summary) {
  final backendData = summary.backendData ?? const <String, dynamic>{};
  return PiSessionInfo(
    path: backendData['path'] as String? ?? '',
    id: summary.id,
    cwd: summary.cwd,
    parentSessionPath: backendData['parentSessionPath'] as String?,
    created: DateTime.fromMillisecondsSinceEpoch(summary.createdAtMs),
    modified: DateTime.fromMillisecondsSinceEpoch(summary.updatedAtMs),
    messageCount: (backendData['messageCount'] as num?)?.toInt() ?? 0,
    firstMessage: summary.title,
    summary: _statsFromSummary(summary),
  );
}

SessionSummaryStats? _statsFromSummary(RuntimeSessionSummary summary) {
  final stats = summary.summary;
  if (stats == null) return null;
  return SessionSummaryStats(
    additions: stats.additions,
    deletions: stats.deletions,
    files: stats.files,
  );
}
