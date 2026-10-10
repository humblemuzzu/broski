@Tags(['e2e'])
library;

import 'dart:io';

import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski/services/link/pairing_service.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'e2e/fake_bridge.dart';
import 'e2e/link_daemon.dart';

/// Connectivity plugins have no method channel in a test binding.
final class _SilentNetworkMonitor extends NetworkMonitorService {
  @override
  Future<void> startMonitoring() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    // The test binding stubs HttpClient; this test drives real sockets.
    HttpOverrides.global = null;
  });

  test(
    'pairs this app with the real daemon over the LAN',
    () async {
      final daemon = await LinkDaemon.start();
      final bridge = await FakeBridge.start(daemon.bridgeSocket);
      addTearDown(bridge.close);

      final uri = await daemon.pairingUri();
      final offer = PairingOffer.parse(uri);
      final pending = parsePairingInput(
        LinkDaemon.pointAt(uri, daemon.lanCandidate),
        DateTime.now().toUtc(),
      );
      expect(pending, isNotNull, reason: 'the daemon opens a v2 offer');

      final container = ProviderContainer(
        overrides: <Override>[
          networkMonitorServiceProvider.overrideWithValue(
            _SilentNetworkMonitor(),
          ),
        ],
      );
      addTearDown(container.dispose);

      final machine = await container
          .read(pairingServiceProvider)
          .pair(pending!);
      final identity = await container.read(deviceIdentityProvider.future);

      expect(machine.id, pending.machineId);
      expect(machine.name, offer.name);
      expect(machine.relayToken, isNotNull);
      expect(machine.lan, (await daemon.status())['lan']);
      expect(
        container.read(machinesProvider).machines.map((stored) => stored.id),
        <String>[machine.id],
      );
      expect(
        (await daemon.status())['machine'],
        containsPair('id', machine.id),
      );
      expect((await daemon.devices()).single, containsPair('id', identity.id));
      expect(bridge.connectionCount, greaterThanOrEqualTo(1));
      expect(bridge.header(0, 'x-broski-device-id'), identity.id);
      expect(bridge.header(0, 'x-broski-role'), 'owner');
    },
    timeout: const Timeout(Duration(seconds: 300)),
  );
}
