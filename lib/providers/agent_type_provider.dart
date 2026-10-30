import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final agentTypeProvider = StateNotifierProvider<AgentTypeNotifier, AgentType>((
  ref,
) {
  final storage = ref.watch(storageServiceProvider);
  return AgentTypeNotifier(ref, storage);
});

class AgentTypeNotifier extends StateNotifier<AgentType> {
  AgentTypeNotifier(this._ref, this._storage) : super(AgentType.opencode) {
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

  bool _didAutoSelectForConnection = false;
  bool _loaded = false;
  AgentsStatus? _latestBackends;

  Future<void> _load() async {
    final saved = await _storage.getSelectedAgentType();
    if (saved != null) {
      state = AgentType.fromWireValue(saved);
    }
    _loaded = true;
    if (_latestBackends != null) {
      _maybeAutoSelectBackend();
    }
  }

  Future<void> setAgentType(AgentType type) async {
    state = type;
    await _storage.setSelectedAgentType(type.wireValue);
  }

  void _maybeAutoSelectBackend() {
    if (!_loaded) return;
    final backends = _latestBackends;
    if (backends == null) return;
    final conn = _ref.read(connectionProvider);
    if (!conn.isConnected) return;
    if (_didAutoSelectForConnection) return;

    if (backends.forType(state).available) {
      _didAutoSelectForConnection = true;
      return;
    }

    AgentType? best;
    if (backends.claudeCode.available) {
      best = AgentType.claudeCode;
    } else if (backends.opencode.available) {
      best = AgentType.opencode;
    } else if (backends.codex.available) {
      best = AgentType.codex;
    }

    final selected = best;
    _didAutoSelectForConnection = true;
    if (selected == null || selected == state) return;

    () async {
      await setAgentType(selected);
      _ref.read(bridgeServiceProvider).setAgent(selected);
    }();
  }

  bool get isOpenCode => state == AgentType.opencode;
  bool get isClaudeCode => state == AgentType.claudeCode;
  bool get isCodex => state == AgentType.codex;
}

final agentsStatusProvider = FutureProvider<AgentsStatus?>((ref) async {
  try {
    final bridge = ref.read(bridgeServiceProvider);
    return await bridge.getAgentsStatus();
  } catch (_) {
    return null;
  }
});
