import 'package:broski/models/agent_type.dart';

/// The backend to boot on given what was persisted. A stored experimental
/// backend stays hidden while its flag is off, so the app never boots onto one
/// the rest of the UI hides. Null means nothing was persisted.
AgentType? restoredAgentType(
  String? savedWireValue, {
  required bool piDurableEnabled,
}) {
  if (savedWireValue == null) return null;
  final restored = AgentType.fromWireValue(savedWireValue);
  if (!isExperimentalAgent(restored)) return restored;
  return resolveVisibleAgent(restored, piDurableEnabled: piDurableEnabled);
}

/// Whether [backend] is allowed to be the selected backend at all.
bool isSelectableAgent(AgentType backend, {required bool piDurableEnabled}) =>
    !isExperimentalAgent(backend) || piDurableEnabled;
