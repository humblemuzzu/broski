import 'dart:async';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_machine.dart';
import 'wait_for.dart';

/// A 1217-byte bundle whose first byte is the version the Rust side accepts.
Uint8List fakeBundle() {
  final bundle = Uint8List(publicBundleLength);
  bundle[0] = 1;
  return bundle;
}

/// One running [LinkConnection] and every status it reported.
final class Harness {
  Harness._(this.machine, this.connection) {
    _subscription = connection.status.listen(statuses.add);
  }

  final FakeMachine machine;
  final LinkConnection connection;
  final List<LinkStatus> statuses = [];
  late final StreamSubscription<LinkStatus> _subscription;

  Future<void> dispose() async {
    await _subscription.cancel();
    await connection.close();
    await machine.close();
  }
}

/// Starts a connection towards [machine] and registers its cleanup.
Future<Harness> startHarness(
  FakeMachine machine, {
  List<String> lan = const <String>[],
}) async {
  final connection = await LinkConnection.start(
    identitySecret: LinkIdentity.generate().secret,
    endpoint: MachineEndpoint(
      machineId: 'machine-1',
      serverPublicBundle: fakeBundle(),
      deviceId: 'device-1',
      lan: lan,
      relay: machine.relayUri,
      relayToken: 'token',
    ),
  );
  final harness = Harness._(machine, connection);
  addTearDown(harness.dispose);
  return harness;
}

/// Waits for a status at or after [from] that matches [test].
Future<LinkStatus> waitForStatus(
  Harness harness,
  bool Function(LinkStatus status) test, {
  int from = 0,
  String? reason,
}) async {
  await waitFor(
    () => harness.statuses.skip(from).any(test),
    reason: reason ?? 'a matching status, saw ${harness.statuses}',
  );
  return harness.statuses.skip(from).firstWhere(test);
}
