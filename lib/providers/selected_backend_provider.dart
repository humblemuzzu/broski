import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The backend the person works with, kept across restarts.
final selectedBackendProvider =
    StateNotifierProvider<SelectedBackendNotifier, SelectedBackend>(
      (ref) => SelectedBackendNotifier(ref.watch(storageServiceProvider)),
    );

/// The old-protocol agent the selection names; null while a contract backend
/// is selected.
final legacyAgentProvider = Provider<AgentType?>(
  (ref) => ref.watch(selectedBackendProvider).legacy,
);

/// Whether the stored selection has been read: until then the selection is
/// the default, not necessarily the person's.
final selectedBackendReadyProvider = FutureProvider<void>(
  (ref) => ref.watch(selectedBackendProvider.notifier).ready,
);

class SelectedBackendNotifier extends StateNotifier<SelectedBackend> {
  SelectedBackendNotifier(this._storage)
    : super(const LegacySelection(AgentType.claudeCode)) {
    ready = _load();
  }

  final StorageService _storage;

  /// Completes once the stored selection has been read and applied.
  late final Future<void> ready;

  AgentType _lastLegacy = AgentType.claudeCode;
  bool _chosen = false;

  /// The old-protocol agent most recently selected: what the screens that
  /// still act for one see while a contract backend is selected.
  AgentType get lastLegacy => _lastLegacy;

  /// A store that cannot be read leaves the default choice: the tabs waiting
  /// on [ready] must not wait on a failure.
  Future<void> _load() async {
    final String? saved;
    try {
      saved = await _storage.getSelectedAgentType();
    } catch (_) {
      return;
    }
    final selection = saved == null ? null : SelectedBackend.fromWire(saved);
    if (selection != null && !_chosen && mounted) _apply(selection);
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
}
