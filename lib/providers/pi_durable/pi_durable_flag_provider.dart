import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the experimental Pi Durable backend is visible in the app.
/// Persisted, default OFF.
final piDurableEnabledProvider =
    StateNotifierProvider<PiDurableFlagNotifier, bool>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return PiDurableFlagNotifier(ref, storage);
    });

class PiDurableFlagNotifier extends StateNotifier<bool> {
  PiDurableFlagNotifier(this._ref, this._storage) : super(false) {
    _load();
  }

  final Ref _ref;
  final StorageService _storage;
  bool _loaded = false;

  Future<void> _load() async {
    final enabled = await _storage.getPiDurableEnabled();
    if (!mounted) return;
    state = enabled;
    _loaded = true;
    if (!enabled) _retreatFromHiddenBackend();
  }

  Future<void> setEnabled(bool enabled) async {
    state = enabled;
    await _storage.setPiDurableEnabled(enabled);
    if (!enabled) _retreatFromHiddenBackend();
  }

  /// Turning the flag off must not leave the app pointed at a backend the rest
  /// of the UI can no longer reach.
  void _retreatFromHiddenBackend() {
    if (!_loaded) return;
    final notifier = _ref.read(agentTypeProvider.notifier);
    final current = _ref.read(agentTypeProvider);
    final resolved = resolveVisibleAgent(current, piDurableEnabled: false);
    if (resolved == current) return;
    notifier.setAgentType(resolved);
    _ref.read(bridgeServiceProvider).setAgent(resolved);
  }
}
