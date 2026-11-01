import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';

/// How a chosen backend is named on screen: the old protocol's own name and
/// badge, or the contract backend's label.
extension SelectedBackendLabel on SelectedBackend {
  String get displayName => switch (this) {
    LegacySelection(:final type) => type.displayName,
    ContractSelection(:final id) => backendLabel(id),
  };

  String get badge => switch (this) {
    LegacySelection(type: AgentType.opencode) => 'OC',
    LegacySelection(type: AgentType.claudeCode) => 'CC',
    LegacySelection(type: AgentType.codex) => 'CX',
    ContractSelection(:final id) => backendBadge(id),
  };
}
