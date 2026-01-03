import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../services/storage_service.dart';
import 'service_providers.dart';

final agentTypeProvider = StateNotifierProvider<AgentTypeNotifier, AgentType>((
  ref,
) {
  final storage = ref.watch(storageServiceProvider);
  return AgentTypeNotifier(storage);
});

class AgentTypeNotifier extends StateNotifier<AgentType> {
  AgentTypeNotifier(this._storage) : super(AgentType.opencode) {
    _load();
  }

  final StorageService _storage;

  Future<void> _load() async {
    final saved = await _storage.getSelectedAgentType();
    if (saved != null) {
      state = AgentType.fromWireValue(saved);
    }
  }

  Future<void> setAgentType(AgentType type) async {
    state = type;
    await _storage.setSelectedAgentType(type.wireValue);
  }

  bool get isOpenCode => state == AgentType.opencode;
  bool get isClaudeCode => state == AgentType.claudeCode;
  bool get isCodex => state == AgentType.codex;
}

final agentsStatusProvider = FutureProvider<AgentsStatus?>((ref) async {
  return null;
});
