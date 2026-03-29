import 'dart:async';

import 'package:broski/models/codex.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/codex/cx_error_listener.dart';
import 'package:broski/providers/codex/cx_rate_limits_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// `null` means "all projects" for Codex threads.
final codexThreadsFilterCwdProvider = StateProvider<String?>((ref) => null);

/// Reactive deprecation notice from Codex (set by cx_global notifications).
final cxDeprecationNoticeProvider = StateProvider<String?>((ref) => null);

/// Reactive config warning from Codex (set by cx_global notifications).
final cxConfigWarningProvider = StateProvider<String?>((ref) => null);

/// Cached experimental features from bootstrap (avoids redundant re-fetch).
final cxExperimentalFeaturesProvider =
    StateProvider<List<Map<String, dynamic>>>((ref) => []);

/// Project list for Codex threads screen (used by "New Session" sheet).
/// Online: uses `cx_list_projects`.
/// Offline: uses cached projects, falls back to deriving from cached threads.
final codexProjectsForThreadsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final storage = ref.watch(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  Future<List<ProjectSummary>> fromCache() async {
    final cachedProjects = await storage.getCachedCodexProjects();
    if (cachedProjects.isNotEmpty) return cachedProjects;

    final cachedThreads = await storage.getCachedCodexThreads();
    final byPath = <String, ProjectSummary>{};
    for (final t in cachedThreads) {
      final path = t.cwd;
      if (path.isEmpty) continue;
      final parts = path.split('/').where((p) => p.isNotEmpty).toList();
      final name = parts.isEmpty ? path : parts.last;
      byPath[path] = ProjectSummary(id: path, name: name, path: path);
    }
    final projects = byPath.values.toList();
    projects.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );
    return projects;
  }

  if (connection.isOfflineMode) {
    return await fromCache();
  }

  try {
    final projects = await bridge.cxListProjects();
    if (projects.isNotEmpty) {
      await storage.cacheCodexProjects(projects);
      return projects;
    }
    return await fromCache();
  } catch (_) {
    return await fromCache();
  }
});

/// Derived project list for filter sheet — computed directly from loaded
/// Codex threads. Guaranteed: if threads show in the list, projects show in
/// the filter. No separate API call, no timing issues.
final codexFilterProjectsProvider = Provider<AsyncValue<List<ProjectSummary>>>((
  ref,
) {
  final threadsAsync = ref.watch(codexThreadsProvider);
  return threadsAsync.whenData((threads) {
    final byPath = <String, ProjectSummary>{};
    for (final t in threads) {
      final path = t.cwd;
      if (path.isEmpty) continue;
      final parts = path.split('/').where((p) => p.isNotEmpty).toList();
      final name = parts.isEmpty ? path : parts.last;
      byPath[path] = ProjectSummary(id: path, name: name, path: path);
    }
    return byPath.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  });
});

final codexThreadsProvider =
    StateNotifierProvider<CodexThreadsNotifier, AsyncValue<List<CodexThread>>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      final connection = ref.read(connectionProvider);
      return CodexThreadsNotifier(bridge, storage, connection, ref);
    });

class CodexThreadsNotifier
    extends StateNotifier<AsyncValue<List<CodexThread>>> {
  CodexThreadsNotifier(this._bridge, this._storage, this._connection, this._ref)
    : super(const AsyncValue.loading()) {
    unawaited(_bootstrap());
    _bridgeMessagesSub = _bridge.messages.listen(_handleBridgeMessage);
  }

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;
  final Ref _ref;

  StreamSubscription<Map<String, dynamic>>? _bridgeMessagesSub;
  String? _lastCwd;
  String? _nextCursor;
  bool _loadingMore = false;
  static bool _codexWarmupStarted = false;

  Future<void> _bootstrap() async {
    if (_connection.isOfflineMode) {
      // Serve cached experimental features when offline.
      final cached = await _storage.getCachedCodexExperimentalFeatures();
      if (cached.isNotEmpty) {
        _ref.read(cxExperimentalFeaturesProvider.notifier).state = cached;
      }
      return;
    }

    // Warm bridge-side Codex caches once per app lifecycle.
    if (!_codexWarmupStarted) {
      _codexWarmupStarted = true;
      try {
        await _bridge.cxWarmup();
      } catch (_) {
        // Best-effort warmup only.
      }
    }

    // Preload experimental features into reactive provider for UI consumption.
    try {
      final features = await _bridge.cxListExperimentalFeatures();
      _ref.read(cxExperimentalFeaturesProvider.notifier).state = features;
      if (features.isNotEmpty) {
        await _storage.cacheCodexExperimentalFeatures(features);
      }
    } catch (_) {
      // Fall back to cached features on error.
      final cached = await _storage.getCachedCodexExperimentalFeatures();
      if (cached.isNotEmpty) {
        _ref.read(cxExperimentalFeaturesProvider.notifier).state = cached;
      }
    }
  }

  void _handleBridgeMessage(Map<String, dynamic> message) {
    if (_connection.isOfflineMode) return;
    final type = message['type'] as String? ?? '';
    if (type == 'cx_error') {
      final error = message['error'] as String? ?? 'Unknown error';
      final code = message['code'] as String?;
      final handler = message['handler'] as String?;
      _ref.read(cxLatestErrorProvider.notifier).state = CxError(
        message: error,
        code: code,
        handler: handler,
      );
      return;
    }
    if (type != 'cx_global') return;
    final data = message['data'] as Map<String, dynamic>? ?? const {};
    final method = data['method'] as String? ?? '';
    if (method == 'thread/archived' || method == 'thread/unarchived') {
      unawaited(refresh(cwd: _lastCwd));
    }
    if (method == 'thread/name/updated') {
      // Refresh the thread list so renamed threads show updated names
      unawaited(refresh(cwd: _lastCwd));
    }
    // Push deprecation notices and config warnings into reactive providers
    if (method == 'deprecationNotice') {
      final summary =
          data['summary']?.toString() ??
          data['params']?['summary']?.toString() ??
          '';
      if (summary.isNotEmpty) {
        _ref.read(cxDeprecationNoticeProvider.notifier).state = summary;
      }
    }
    if (method == 'configWarning') {
      final warning =
          data['message']?.toString() ??
          data['params']?['message']?.toString() ??
          '';
      if (warning.isNotEmpty) {
        _ref.read(cxConfigWarningProvider.notifier).state = warning;
      }
    }
    if (method == 'account/rateLimits/updated') {
      final params = data['params'] as Map<String, dynamic>? ?? const {};
      _ref.read(cxLiveRateLimitsProvider.notifier).state = params.isEmpty
          ? null
          : params;
    }
    // Thread closed — remove from in-memory list without full refresh.
    if (method == 'thread/closed') {
      final closedId =
          (data['params'] as Map<String, dynamic>?)?['threadId']?.toString() ??
          '';
      if (closedId.isNotEmpty) {
        state = state.whenData(
          (threads) => threads.where((t) => t.id != closedId).toList(),
        );
      }
    }
    // Account login completed — refresh threads.
    if (method == 'account/login/completed') {
      unawaited(refresh(cwd: _lastCwd));
    }
    // Account updated — refresh threads on account change.
    if (method == 'account/updated') {
      unawaited(refresh(cwd: _lastCwd));
    }
    // skills/changed, app/list/updated, mcpServer/startupStatus/updated,
    // mcpServer/oauthLogin/completed — no notifier action needed here.
    // Skills/apps/MCP sheets re-fetch on open.
  }

  @override
  void dispose() {
    _bridgeMessagesSub?.cancel();
    super.dispose();
  }

  Future<void> _primeRuntimeThreadState(List<CodexThread> threads) async {
    if (_connection.isOfflineMode || threads.isEmpty) return;

    try {
      final loaded = await _bridge.cxThreadLoadedList(limit: 50);
      final preferredId = loaded.isNotEmpty ? loaded.first : threads.first.id;
      if (preferredId.isNotEmpty) {
        await _bridge.cxThreadRead(threadId: preferredId, includeTurns: false);
      }
    } catch (_) {
      // Runtime state priming is optional.
    }
  }

  Future<void> _cacheProjectsFromThreads(List<CodexThread> threads) async {
    final byPath = <String, ProjectSummary>{};
    for (final t in threads) {
      final path = t.cwd;
      if (path.isEmpty) continue;
      final parts = path.split('/').where((p) => p.isNotEmpty).toList();
      final name = parts.isEmpty ? path : parts.last;
      byPath[path] = ProjectSummary(id: path, name: name, path: path);
    }
    if (byPath.isEmpty) return;
    final projects = byPath.values.toList();
    projects.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );
    await _storage.cacheCodexProjects(projects);
  }

  Future<void> load({String? cwd}) async {
    _lastCwd = cwd;
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCodexThreads();
      state = AsyncValue.data(cached);
      return;
    }

    state = const AsyncValue.loading();
    try {
      final page = await _bridge.cxListThreadsPage(cwd: cwd, limit: 50);
      _nextCursor = page.nextCursor;
      final threads = page.threads;
      if (threads.isNotEmpty) {
        await _storage.cacheCodexThreads(threads);
        await _cacheProjectsFromThreads(threads);
      }
      unawaited(_primeRuntimeThreadState(threads));
      state = AsyncValue.data(threads);
    } catch (e, st) {
      final cached = await _storage.getCachedCodexThreads();
      if (cached.isNotEmpty) {
        state = AsyncValue.data(cached);
      } else {
        state = AsyncValue.error(e, st);
      }
    }
  }

  Future<void> refresh({String? cwd}) async {
    _lastCwd = cwd ?? _lastCwd;
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCodexThreads();
      state = AsyncValue.data(cached);
      return;
    }

    try {
      final page = await _bridge.cxListThreadsPage(cwd: _lastCwd, limit: 50);
      _nextCursor = page.nextCursor;
      final threads = page.threads;
      if (threads.isNotEmpty) {
        await _storage.cacheCodexThreads(threads);
        await _cacheProjectsFromThreads(threads);
      }
      unawaited(_primeRuntimeThreadState(threads));
      state = AsyncValue.data(threads);
    } catch (e, st) {
      final cached = await _storage.getCachedCodexThreads();
      if (cached.isNotEmpty && !state.hasValue) {
        state = AsyncValue.data(cached);
      } else if (!state.hasValue) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// Whether there are more pages of threads available.
  bool get hasMore => _nextCursor != null;

  /// Loads the next page of threads and appends them to the current list.
  Future<void> loadMore() async {
    if (_loadingMore || _nextCursor == null || _connection.isOfflineMode) {
      return;
    }
    _loadingMore = true;
    try {
      final page = await _bridge.cxListThreadsPage(
        cwd: _lastCwd,
        cursor: _nextCursor,
        limit: 50,
      );
      _nextCursor = page.nextCursor;
      final existing = state.valueOrNull ?? [];
      final existingIds = existing.map((t) => t.id).toSet();
      final newThreads = page.threads
          .where((t) => !existingIds.contains(t.id))
          .toList();
      if (newThreads.isNotEmpty) {
        final merged = [...existing, ...newThreads];
        await _storage.cacheCodexThreads(merged);
        state = AsyncValue.data(merged);
      }
    } catch (_) {
      // Pagination failure is non-fatal — keep showing existing data.
    } finally {
      _loadingMore = false;
    }
  }

  Future<bool> setThreadArchived(
    String threadId, {
    required bool archive,
  }) async {
    try {
      if (archive) {
        // Best-effort compaction before archive so large threads are condensed.
        try {
          await _bridge.cxCompactThread(threadId: threadId);
        } catch (_) {
          // Compaction is optional; continue archive flow.
        }

        final ok = await _bridge.cxArchiveThread(threadId);
        if (ok) {
          state = state.whenData(
            (threads) => threads.where((t) => t.id != threadId).toList(),
          );
        }
        return ok;
      }

      final ok = await _bridge.cxUnarchiveThread(threadId: threadId);
      if (ok) {
        await refresh(cwd: _lastCwd);
      }
      return ok;
    } catch (_) {
      return false;
    }
  }

  Future<bool> archiveThread(String threadId) =>
      setThreadArchived(threadId, archive: true);
}

/// Codex models provider — cache-first, background refresh.
///
/// First open: returns cached models instantly (if any), then refreshes
/// in the background. The list is cached in L1 memory + L2 secure storage
/// so subsequent opens are instant. Models rarely change, so a stale-while-
/// revalidate approach keeps the UI snappy.
final codexModelsProvider =
    StateNotifierProvider<CodexModelsNotifier, AsyncValue<List<CodexModel>>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      final connection = ref.read(connectionProvider);
      final notifier = CodexModelsNotifier(bridge, storage, connection);
      notifier.load();
      return notifier;
    });

class CodexModelsNotifier extends StateNotifier<AsyncValue<List<CodexModel>>> {
  CodexModelsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  Future<void> load() async {
    // 1. Serve from cache instantly
    final cached = await _storage.getCachedCodexModels();
    if (cached.isNotEmpty) {
      state = AsyncValue.data(cached.map(CodexModel.fromJson).toList());
    }

    // 2. If offline, stop here
    if (_connection.isOfflineMode) {
      if (cached.isEmpty) {
        state = const AsyncValue.data([]);
      }
      return;
    }

    // 3. Background refresh from bridge
    try {
      final raw = await _bridge.cxListModels();
      if (raw.isNotEmpty) {
        await _storage.cacheCodexModels(raw);
      }
      if (!mounted) return;
      state = AsyncValue.data(raw.map(CodexModel.fromJson).toList());
    } catch (e, st) {
      // If we already have cached data showing, keep it — don't flash an error
      if (!mounted) return;
      if (!state.hasValue || (state.valueOrNull?.isEmpty ?? true)) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// Force a full refresh (e.g. pull-to-refresh).
  Future<void> refresh() => load();
}

/// Prefetch messages for the top N Codex threads to speed up opening.
void prefetchTopCxThreads(
  WidgetRef ref,
  List<CodexThread> threads, {
  int count = 3,
}) {
  final bridge = ref.read(bridgeServiceProvider);
  for (final thread in threads.take(count)) {
    // Fire and forget — just warm the cache
    bridge
        .cxGetThreadMessages(thread.id)
        .catchError((_) => <CodexTranscriptMessage>[]);
  }
}
