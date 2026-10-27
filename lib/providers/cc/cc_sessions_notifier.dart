import 'dart:async';

import 'package:broski/models/claude_code.dart';
import 'package:broski/models/session_page.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The Claude Code session list: one page at a time, and a failure that the screen can show and
/// retry instead of an empty list that looks like "no sessions".
class CCSessionsNotifier
    extends StateNotifier<AsyncValue<List<ClaudeCodeSession>>> {
  CCSessionsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  String? _cwd;
  String? _nextCursor;
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _loadMoreFailed = false;

  bool get hasMore => _hasMore;
  bool get isLoadingMore => _loadingMore;
  bool get loadMoreFailed => _loadMoreFailed;

  Future<void> load({String? cwd}) async {
    _cwd = cwd;
    if (_connection.isOfflineMode) {
      _hasMore = false;
      _nextCursor = null;
      state = AsyncValue.data(await _storage.getCachedCCSessions());
      return;
    }

    state = const AsyncValue.loading();
    try {
      final page = await _bridge.ccListSessionsPage(
        cwd: cwd,
        limit: kSessionPageLimit,
      );
      _nextCursor = page.nextCursor;
      _hasMore = page.hasAnotherPage;
      _loadMoreFailed = false;
      if (cwd == null && page.items.isNotEmpty) {
        await _storage.cacheCCSessions(page.items);
      }
      state = AsyncValue.data(page.items);
    } catch (error, stackTrace) {
      state = await _withCacheOrError(error, stackTrace);
    }
  }

  Future<void> refresh({String? cwd}) async {
    _cwd = cwd ?? _cwd;
    if (_connection.isOfflineMode) {
      state = AsyncValue.data(await _storage.getCachedCCSessions());
      return;
    }
    try {
      final page = await _bridge.ccListSessionsPage(
        cwd: _cwd,
        limit: kSessionPageLimit,
      );
      _nextCursor = page.nextCursor;
      _hasMore = page.hasAnotherPage;
      _loadMoreFailed = false;
      if (_cwd == null && page.items.isNotEmpty) {
        await _storage.cacheCCSessions(page.items);
      }
      state = AsyncValue.data(page.items);
    } catch (error, stackTrace) {
      state = await _withCacheOrError(error, stackTrace);
    }
  }

  Future<void> loadMore() async {
    final cursor = _nextCursor;
    if (_loadingMore ||
        cursor == null ||
        !_hasMore ||
        _connection.isOfflineMode) {
      return;
    }
    _loadingMore = true;
    _loadMoreFailed = false;
    try {
      final page = await _bridge.ccListSessionsPage(
        cwd: _cwd,
        limit: kSessionPageLimit,
        before: cursor,
      );
      _nextCursor = page.nextCursor;
      _hasMore = page.hasAnotherPage;
      final existing = state.valueOrNull ?? const <ClaudeCodeSession>[];
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

  Future<bool> deleteSession(String sessionId, {String? cwd}) async {
    try {
      final deleted = await _bridge.ccDeleteSession(sessionId, cwd: cwd);
      if (deleted) {
        state = state.whenData(
          (sessions) => sessions.where((s) => s.id != sessionId).toList(),
        );
      }
      return deleted;
    } catch (_) {
      return false;
    }
  }

  Future<AsyncValue<List<ClaudeCodeSession>>> _withCacheOrError(
    Object error,
    StackTrace stackTrace,
  ) async {
    final cached = await _storage.getCachedCCSessions();
    if (cached.isNotEmpty && !state.hasValue) return AsyncValue.data(cached);
    if (state.hasValue) return state;
    return AsyncValue.error(error, stackTrace);
  }
}
