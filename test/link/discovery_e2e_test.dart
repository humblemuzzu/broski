@Tags(['e2e'])
library;

import 'dart:io';

import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/discovery_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/link/discovery/discovered_link.dart';
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

/// Answers every browse with what the daemon really advertises, and nothing else.
final class _FakeBrowser implements LinkServiceBrowser {
  _FakeBrowser(this.answer);

  DiscoveredLink answer;
  final List<Duration> windows = [];

  @override
  Future<List<DiscoveredLink>> browse({required Duration window}) async {
    windows.add(window);
    return [answer];
  }
}

Future<void> _waitFor(bool Function() ready, String what) async {
  final deadline = DateTime.now().add(const Duration(seconds: 60));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  if (!ready()) throw StateError('timed out waiting for $what');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    HttpOverrides.global = null;
  });

  test(
    'a machine whose stored address is wrong is found again by discovery',
    () async {
      final daemon = await LinkDaemon.start();
      final bridge = await FakeBridge.start(daemon.bridgeSocket);
      addTearDown(bridge.close);

      final uri = await daemon.pairingUri();
      final pending = parsePairingInput(
        LinkDaemon.pointAt(uri, daemon.lanCandidate),
        DateTime.now().toUtc(),
      );
      expect(pending, isNotNull, reason: 'the daemon opens a v2 offer');

      // Pair once, then leave the record pointing at a port nothing serves.
      final pairing = ProviderContainer(
        overrides: <Override>[
          networkMonitorServiceProvider.overrideWithValue(
            _SilentNetworkMonitor(),
          ),
        ],
      );
      addTearDown(pairing.dispose);
      final paired = await pairing.read(pairingServiceProvider).pair(pending!);
      final deadPort = await freePort();
      final stale = paired.copyWith(lan: <String>['127.0.0.1:$deadPort']);
      await pairing.read(machinesProvider.notifier).update(stale);
      pairing.dispose();

      final browser = _FakeBrowser(
        DiscoveredLink(
          machineId: paired.id,
          host: '127.0.0.1',
          port: daemon.lanPort,
        ),
      );
      final container = ProviderContainer(
        overrides: <Override>[
          networkMonitorServiceProvider.overrideWithValue(
            _SilentNetworkMonitor(),
          ),
          linkServiceBrowserProvider.overrideWith((ref) => browser),
        ],
      );
      addTearDown(container.dispose);

      // Every list the record wears, so the discovery's own write can be seen
      // even after the daemon pushes its advert over it.
      final storedLan = <List<String>>[];
      container.listen<MachinesState>(machinesProvider, (_, next) {
        final machine = next.machines
            .where((entry) => entry.id == paired.id)
            .firstOrNull;
        if (machine != null) storedLan.add(machine.lan);
      }, fireImmediately: true);

      // Brings the controller up on the stored, wrong address.
      container.read(linkConnectionControllerProvider);

      await _waitFor(
        () => browser.windows.isNotEmpty,
        'discovery to run for the stale address',
      );
      await _waitFor(() {
        final status = container.read(linkStatusProvider);
        return status?.state == LinkConnectionState.connected &&
            status?.route == LinkRoute.lan;
      }, 'the link to come up over the discovered LAN route');

      final discovered = '127.0.0.1:${daemon.lanPort}';
      expect(
        storedLan.any((lan) => lan.isNotEmpty && lan.first == discovered),
        isTrue,
        reason: 'discovery writes what answered to the front of the record',
      );
      expect(browser.windows.single, linkDiscoveryWindow);
    },
    timeout: const Timeout(Duration(seconds: 300)),
  );
}
