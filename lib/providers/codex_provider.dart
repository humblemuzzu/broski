import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/codex.dart';
import '../services/bridge_service.dart';
import '../services/storage_service.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

/// `null` means "all projects" for Codex threads.
final codexThreadsFilterCwdProvider = StateProvider<String?>((ref) => null);

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
