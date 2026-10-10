import 'package:broski/models/link/machine.dart';
import 'package:broski_link/broski_link.dart';

/// The endpoint the app dials for [machine], paired with this phone's
/// [deviceId].
MachineEndpoint linkEndpoint(Machine machine, {required String deviceId}) =>
    MachineEndpoint(
      machineId: machine.id,
      serverPublicBundle: machine.publicBundle,
      deviceId: deviceId,
      lan: machine.lan,
      relay: machine.relay,
      relayToken: machine.relayToken,
    );

/// The machine with [id] in [machines], or null.
Machine? machineWithId(Iterable<Machine> machines, String id) {
  for (final machine in machines) {
    if (machine.id == id) return machine;
  }
  return null;
}
