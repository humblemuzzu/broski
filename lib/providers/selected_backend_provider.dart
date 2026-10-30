import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The backend the person works with, kept across restarts.
final selectedBackendProvider =
    StateNotifierProvider<SelectedBackendNotifier, SelectedBackend>(
      (ref) => SelectedBackendNotifier(ref, ref.watch(storageServiceProvider)),
    );

/// The old-protocol agent the selection names; null while a contract backend
/// is selected.
final legacyAgentProvider = Provider<AgentType?>(
  (ref) => ref.watch(selectedBackendProvider).legacy,
);

class SelectedBackendNotifier extends StateNotifier<SelectedBackend> {
  SelectedBackendNotifier(this._ref, this._storage)
    : super(const LegacySelection(AgentType.opencode)) {
    _load();
    _ref.listen<ConnectionEvent?>(
      connectionProvider.select((s) => s.lastEvent),
      (prev, next) {
        if (next == ConnectionEvent.connected ||
            next == ConnectionEvent.reconnected) {
          _didAutoSelectForConnection = false;
          _maybeAutoSelectBackend();
        }
      },
    );
    _ref.listen<AgentsStatus?>(connectionProvider.select((s) => s.backends), (
      prev,
      next,
    ) {
      if (next == null) return;
      _latestBackends = next;
      _maybeAutoSelectBackend();
    });
  }

  final Ref _ref;
  final StorageService _storage;

  AgentType _lastLegacy = AgentType.opencode;
  bool _didAutoSelectForConnection = false;
  bool _loaded = false;
  bool _chosen = false;
  AgentsStatus? _latestBackends;

  /// The old-protocol agent most recently selected: what the screens that
  /// still act for one see while a contract backend is selected.
  AgentType get lastLegacy => _lastLegacy;

  Future<void> _load() async {
    final saved = await _storage.getSelectedAgentType();
    final selection = saved == null ? null : SelectedBackend.fromWire(saved);
    if (selection != null && !_chosen) _apply(selection);
    _loaded = true;
    if (_latestBackends != null) _maybeAutoSelectBackend();
  }

  Future<void> select(SelectedBackend selection) async {
    _chosen = true;
    _apply(selection);
    await _storage.setSelectedAgentType(selection.wire);
  }

  void _apply(SelectedBackend selection) {
    if (selection.legacy case final legacy?) _lastLegacy = legacy;
    state = selection;
  }

  void _maybeAutoSelectBackend() {
    if (!_loaded) return;
    final backends = _latestBackends;
    final current = state.legacy;
    if (backends == null || current == null) return;
    if (!_ref.read(connectionProvider).isConnected) return;
    if (_didAutoSelectForConnection) return;
    _didAutoSelectForConnection = true;
    if (backends.forType(current).available) return;

    final best = [
      AgentType.claudeCode,
      AgentType.opencode,
      AgentType.codex,
    ].where((type) => backends.forType(type).available).firstOrNull;
    if (best == null || best == current) return;
    () async {
      await select(LegacySelection(best));
      _ref.read(bridgeServiceProvider).setAgent(best);
    }();
  }
}
