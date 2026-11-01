import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';

/// How a chosen backend is named on screen: the old protocol's own name and
/// badge, or the contract backend's label, marked new where an old agent
/// goes by the same name.
extension SelectedBackendLabel on SelectedBackend {
  String get displayName => switch (this) {
    LegacySelection(:final type) => type.displayName,
    ContractSelection(:final id, :final sharesLegacyName) =>
      sharesLegacyName ? '${backendLabel(id)} (new)' : backendLabel(id),
  };

  String get badge => switch (this) {
    LegacySelection(type: AgentType.claudeCode) => 'CC',
    ContractSelection(:final id) => backendBadge(id),
  };
}
