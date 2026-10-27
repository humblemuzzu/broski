import 'dart:async';
import 'dart:typed_data';

import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/link_session_start_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/link/link_session_starter.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../link/link_fixtures.dart';

/// A link that answers nothing and records what was done to it.
class FakeLinkSession implements LinkSession {
  final StreamController<String> _bridge = StreamController<String>.broadcast();
  final StreamController<Map<String, Object?>> _control =
      StreamController<Map<String, Object?>>.broadcast();
  final StreamController<LinkStatus> _status =
      StreamController<LinkStatus>.broadcast();
  final StreamController<BridgeLinkStatus> _bridgeStatus =
      StreamController<BridgeLinkStatus>.broadcast();
  final StreamController<LinkSendFailure> _sendFailures =
      StreamController<LinkSendFailure>.broadcast();

  final List<String> sentControls = [];
  MachineEndpoint? lastEndpoint;
  var closes = 0;

  @override
  Stream<String> get bridgeMessages => _bridge.stream;

  @override
  Stream<Map<String, Object?>> get control => _control.stream;

  @override
  Stream<LinkStatus> get status => _status.stream;

  @override
  Stream<BridgeLinkStatus> get bridgeStatus => _bridgeStatus.stream;

  @override
  Stream<LinkSendFailure> get sendFailures => _sendFailures.stream;

  @override
  void sendBridge(String text, {String? tag}) {}

  @override
  void sendControl(Map<String, Object?> message) =>
      sentControls.add(message['t'] as String? ?? '');

  @override
  void updateEndpoint(MachineEndpoint endpoint) => lastEndpoint = endpoint;

  @override
  void networkChanged() {}

  @override
  void appResumed() {}

  @override
  void appPaused() {}

  @override
  Future<void> close() async {
    closes++;
    await Future<void>.delayed(Duration.zero);
  }
}

/// The monitor's own start talks to a platform channel a test has none of.
class SilentNetworkMonitor extends NetworkMonitorService {
  @override
  Future<void> startMonitoring() async {}
}

Machine testMachineAgain({
  String id = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  String name = 'Studio Mac',
}) => Machine(
  id: id,
  name: name,
  os: 'macOS 26',
  publicBundle: patternBytes(1217),
  fingerprint: patternBytes(32, seed: 7),
  lan: const ['10.0.0.2:8765'],
  relay: Uri.parse('wss://relay.example/x'),
  relayToken: 'relay-token-a',
  pairedAt: DateTime.utc(2026, 1, 2),
);

/// A starter whose every dial waits until the test lets it through.
LinkSessionStarter gatedStarter(List<Completer<LinkSession>> starters) =>
    ({
      required Uint8List identitySecret,
      required MachineEndpoint endpoint,
      Uint8List? pairingSecret,
    }) {
      final gate = Completer<LinkSession>();
      starters.add(gate);
      return gate.future;
    };

Future<void> until(bool Function() ready) async {
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
  if (!ready()) throw StateError('the dial never started');
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 50));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a dial that lands after a newer one is closed, never adopted', () async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final identity = LinkIdentity.generate();
    final starters = <Completer<LinkSession>>[];
    final sessions = <FakeLinkSession>[];

    final container = ProviderContainer(
      overrides: [
        networkMonitorServiceProvider.overrideWith(
          (ref) => SilentNetworkMonitor(),
        ),
        deviceIdentityProvider.overrideWith((ref) async => identity),
        linkSessionStarterProvider.overrideWithValue(gatedStarter(starters)),
      ],
    );
    addTearDown(container.dispose);

    final controller = container.read(linkConnectionControllerProvider);
    await container.read(machinesProvider.notifier).add(testMachineAgain());
    await until(() => starters.length == 1);

    // The switch supersedes a dial that is still waiting for its link. It cannot
    // be awaited: its own dial is one this test has not let through yet.
    unawaited(
      controller.switchTo(
        testMachineAgain(
          id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          name: 'Mac Mini',
        ),
      ),
    );
    await until(() => starters.length == 2);

    starters[0].complete(FakeLinkSession()..let(sessions));
    await settle();
    starters[1].complete(FakeLinkSession()..let(sessions));
    await settle();

    expect(sessions, hasLength(2));
    expect(sessions[0].closes, 1, reason: 'the superseded dial is closed');
    expect(sessions[1].closes, 0, reason: 'the winner keeps its link');
  });
}

extension on FakeLinkSession {
  void let(List<FakeLinkSession> sessions) => sessions.add(this);
}
