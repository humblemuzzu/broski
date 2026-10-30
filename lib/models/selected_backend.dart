import 'package:broski/agent/ui/backend_label.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/agent_type.dart';

/// The backend the person works with: one of the three that still speak the
/// old protocol, or one the bridge serves through the contract. Only this
/// file and what is built on it know both kinds; `lib/agent/` never sees
/// [AgentType].
sealed class SelectedBackend {
  const SelectedBackend();

  /// What is stored, and the old protocol's name for it.
  String get wire;

  String get displayName;

  String get badge;

  /// The old-protocol agent, or null for a contract backend.
  AgentType? get legacy;

  /// The selection [wire] names, or null when it names nothing known.
  static SelectedBackend? fromWire(String wire) {
    for (final type in AgentType.values) {
      if (type.wireValue == wire) return LegacySelection(type);
    }
    for (final id in BackendId.values) {
      if (id.wire == wire) return ContractSelection(id);
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is SelectedBackend &&
      other.runtimeType == runtimeType &&
      other.wire == wire;

  @override
  int get hashCode => Object.hash(runtimeType, wire);
}

final class LegacySelection extends SelectedBackend {
  const LegacySelection(this.type);

  final AgentType type;

  @override
  String get wire => type.wireValue;

  @override
  String get displayName => type.displayName;

  @override
  String get badge => switch (type) {
    AgentType.opencode => 'OC',
    AgentType.claudeCode => 'CC',
    AgentType.codex => 'CX',
  };

  @override
  AgentType get legacy => type;
}

final class ContractSelection extends SelectedBackend {
  const ContractSelection(this.id);

  final BackendId id;

  @override
  String get wire => id.wire;

  @override
  String get displayName => backendLabel(id);

  @override
  String get badge => backendBadge(id);

  @override
  AgentType? get legacy => null;
}
