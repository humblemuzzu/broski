import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/codex.dart';
import '../models/project.dart';
import '../services/bridge_service.dart';
import '../services/storage_service.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

/// `null` means "all projects" for Codex threads.
final codexThreadsFilterCwdProvider = StateProvider<String?>((ref) => null);

/// Project list for Codex threads screen.
/// Online: uses `cx_list_projects`.
/// Offline: uses cached projects, falls back to deriving from cached threads.
final codexProjectsForThreadsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final storage = ref.watch(storageServiceProvider);
  // Use ref.read() to avoid rebuilding provider on every connection state change
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
    }
    return projects;
  } catch (_) {
    return await fromCache();
  }
});

final codexThreadsProvider =
    StateNotifierProvider<CodexThreadsNotifier, AsyncValue<List<CodexThread>>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      final connection = ref.read(connectionProvider);
      return CodexThreadsNotifier(bridge, storage, connection);
    });

class CodexThreadsNotifier
    extends StateNotifier<AsyncValue<List<CodexThread>>> {
  CodexThreadsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

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
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCodexThreads();
      state = AsyncValue.data(cached);
      return;
    }

    state = const AsyncValue.loading();
    try {
      final threads = await _bridge.cxListThreads(cwd: cwd);
      if (threads.isNotEmpty) {
        await _storage.cacheCodexThreads(threads);
        await _cacheProjectsFromThreads(threads);
      }
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
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCodexThreads();
      state = AsyncValue.data(cached);
      return;
    }

    try {
      final threads = await _bridge.cxListThreads(cwd: cwd);
      if (threads.isNotEmpty) {
        await _storage.cacheCodexThreads(threads);
        await _cacheProjectsFromThreads(threads);
      }
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

  Future<bool> archiveThread(String threadId) async {
    try {
      final ok = await _bridge.cxArchiveThread(threadId);
      if (ok) {
        state = state.whenData(
          (threads) => threads.where((t) => t.id != threadId).toList(),
        );
      }
      return ok;
    } catch (_) {
      return false;
    }
  }
}
