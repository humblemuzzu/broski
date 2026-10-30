import 'package:broski/agent/agent_providers.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the selected backend can be used now, for the screens that show
/// the link and its agent in one indicator.
final selectedAgentAvailableProvider = Provider<bool>((ref) {
  final connection = ref.watch(connectionProvider);
  return switch (ref.watch(selectedBackendProvider)) {
    LegacySelection(:final type) =>
      connection.backends?.forType(type).available ??
          (type == AgentType.opencode ? connection.opencodeRunning : true),
    ContractSelection(:final id) =>
      ref.watch(backendsProvider).statuses[id]?.usable ?? true,
  };
});
