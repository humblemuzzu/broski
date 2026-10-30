import 'package:broski/models/agent_type.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The old-protocol agent the screens that still act for one use. While a
/// contract backend is selected it stays the one selected last; the screens
/// that must tell the two apart read [selectedBackendProvider] or
/// [legacyAgentProvider].
final agentTypeProvider = Provider<AgentType>((ref) {
  ref.watch(selectedBackendProvider);
  return ref.read(selectedBackendProvider.notifier).lastLegacy;
});

final agentsStatusProvider = FutureProvider<AgentsStatus?>((ref) async {
  try {
    final bridge = ref.read(bridgeServiceProvider);
    return await bridge.getAgentsStatus();
  } catch (_) {
    return null;
  }
});
