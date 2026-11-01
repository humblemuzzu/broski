import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/agent_type.dart';

/// The backend the person works with: the one that still speaks the old
/// protocol (Claude Code), or one the bridge serves through the contract. Only this
/// file and what is built on it know both kinds; `lib/agent/` never sees
/// [AgentType].
sealed class SelectedBackend {
  const SelectedBackend();

  /// What is stored: the old protocol's name for a legacy agent; a contract
  /// backend's id, behind [contractPrefix] when an old agent has the same name.
  String get wire;

  /// The old-protocol agent, or null for a contract backend.
  AgentType? get legacy;

  /// Marks a stored contract selection, so a contract backend whose id is
  /// also an old agent's name (`claude-code`) is never read as the old agent.
  static const contractPrefix = 'contract:';

  /// The selection [wire] names, or null when it names nothing known. A bare
  /// name is the old agent's first: what an older app stored stays the old
  /// agent until the person picks otherwise.
  static SelectedBackend? fromWire(String wire) {
    if (wire.startsWith(contractPrefix)) {
      final id = wire.substring(contractPrefix.length);
      for (final backend in BackendId.values) {
        if (backend.wire == id) return ContractSelection(backend);
      }
      return null;
    }
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
  AgentType get legacy => type;
}

final class ContractSelection extends SelectedBackend {
  const ContractSelection(this.id);

  final BackendId id;

  /// Whether an old-protocol agent goes by this backend's name: both are
  /// offered while the bridge serves the contract one, and told apart.
  bool get sharesLegacyName =>
      AgentType.values.any((type) => type.wireValue == id.wire);

  @override
  String get wire => sharesLegacyName
      ? '${SelectedBackend.contractPrefix}${id.wire}'
      : id.wire;

  @override
  AgentType? get legacy => null;
}
