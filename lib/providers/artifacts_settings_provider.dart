import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/artifacts_settings.dart';
import '../services/bridge_service.dart';
import 'service_providers.dart';

class ArtifactsConfigNotifier extends StateNotifier<AsyncValue<ArtifactsConfig>> {
  ArtifactsConfigNotifier(this._bridge) : super(const AsyncValue.loading()) {
    load();
  }

  final BridgeService _bridge;

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final cfg = await _bridge.getArtifactsConfig();
      state = AsyncValue.data(cfg);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<void> update(ArtifactsConfig next) async {
    state = AsyncValue.data(next);
    try {
      final saved = await _bridge.setArtifactsConfig(next);
      state = AsyncValue.data(saved);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      // Best-effort reload to resync.
      await load();
    }
  }

  Future<bool> enrichNow() async {
    try {
      return await _bridge.enrichArtifactsNow();
    } catch (_) {
      return false;
    }
  }

  Future<bool> clearIndex() async {
    try {
      return await _bridge.clearArtifacts();
    } catch (_) {
      return false;
    }
  }
}

final artifactsConfigProvider =
    StateNotifierProvider<ArtifactsConfigNotifier, AsyncValue<ArtifactsConfig>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      return ArtifactsConfigNotifier(bridge);
    });

final artifactsStatsProvider = FutureProvider<ArtifactsStats>((ref) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return await bridge.getArtifactsStats();
});

