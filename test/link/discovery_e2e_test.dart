@Tags(['e2e'])
library;

import 'dart:io';

import 'package:broski/models/link/machine.dart';
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
import 'fake_lan_browse.dart';

/// Connectivity plugins have no method channel in a test binding.
final class _SilentNetworkMonitor extends NetworkMonitorService {
  @override
  Future<void> startMonitoring() async {}
}

/// The phone, with the platform's browse replaced by one the test drives.
final class _Phone {
  _Phone(this.container, this.browser, this.machineId);

  final ProviderContainer container;
  final FakeLanBrowser browser;
  final String machineId;

  LinkStatus? get status => container.read(linkStatusProvider);

  Machine get machine => container
      .read(machinesProvider)
      .machines
      .firstWhere((entry) => entry.id == machineId);

  bool get connectedOverLan =>
      status?.state == LinkConnectionState.connected &&
      status?.route == LinkRoute.lan;

  DiscoveredLink advert(int port) =>
      DiscoveredLink(machineId: machineId, host: '127.0.0.1', port: port);
}

Future<_Phone> _pairedPhone(LinkDaemon daemon) async {
  final uri = await daemon.pairingUri();
  final pending = parsePairingInput(
    LinkDaemon.pointAt(uri, daemon.lanCandidate),
    DateTime.now().toUtc(),
  );
  expect(pending, isNotNull, reason: 'the daemon opens a v2 offer');

  final pairing = ProviderContainer(
    overrides: <Override>[
      networkMonitorServiceProvider.overrideWithValue(_SilentNetworkMonitor()),
    ],
  );
  addTearDown(pairing.dispose);
  final paired = await pairing.read(pairingServiceProvider).pair(pending!);
  // The adopted link finishes announcing itself on a microtask, and a container
  // disposed under it reads from a container that is gone.
  await pumpEventQueue();
  pairing.dispose();

  final browser = FakeLanBrowser();
  final container = ProviderContainer(
    overrides: <Override>[
      networkMonitorServiceProvider.overrideWithValue(_SilentNetworkMonitor()),
      linkServiceBrowserProvider.overrideWithValue(browser),
    ],
  );
  addTearDown(container.dispose);
  await _waitFor(
    () => container.read(machinesProvider).machines.isNotEmpty,
    'the paired machine to load from the store',
  );
  return _Phone(container, browser, paired.id);
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
      final phone = await _pairedPhone(daemon);

      // The record points at a port nothing serves.
      final deadPort = await freePort();
      final stored = phone.machine.copyWith(
        lan: <String>['127.0.0.1:$deadPort'],
      );
      await phone.container.read(machinesProvider.notifier).update(stored);

      final storedLan = <List<String>>[];
      phone.container.listen<MachinesState>(machinesProvider, (_, next) {
        final machine = next.machines
            .where((entry) => entry.id == phone.machineId)
            .firstOrNull;
        if (machine != null) storedLan.add(machine.lan);
      }, fireImmediately: true);

      phone.container.read(linkConnectionControllerProvider);

      await _waitFor(
        () => phone.browser.listening > 0,
        'the browse to start for a stored address that does not answer',
      );
      phone.browser.advertised(phone.advert(daemon.lanPort));

      await _waitFor(() => phone.connectedOverLan, 'the link to come up');
      final discovered = '127.0.0.1:${daemon.lanPort}';
      expect(
        storedLan.any((lan) => lan.isNotEmpty && lan.first == discovered),
        isTrue,
        reason: 'discovery writes what answered to the front of the record',
      );
    },
    timeout: const Timeout(Duration(seconds: 300)),
  );

  test(
    'a daemon restarted on another port is dialled without the app being nudged',
    () async {
      final daemon = await LinkDaemon.start();
      final bridge = await FakeBridge.start(daemon.bridgeSocket);
      addTearDown(bridge.close);
      final phone = await _pairedPhone(daemon);

      final storedLan = <List<String>>[];
      phone.container.listen<MachinesState>(machinesProvider, (_, next) {
        final machine = next.machines
            .where((entry) => entry.id == phone.machineId)
            .firstOrNull;
        if (machine != null) storedLan.add(machine.lan);
      }, fireImmediately: true);

      phone.container.read(linkConnectionControllerProvider);
      await _waitFor(() => phone.connectedOverLan, 'the first LAN connection');
      expect(
        phone.browser.listening,
        0,
        reason: 'a link on the LAN browses not',
      );

      final firstPort = daemon.lanPort;
      await daemon.restartOnNewPort();

      await _waitFor(
        () => phone.browser.listening > 0,
        'the browse to come back while nothing answers',
      );
      phone.browser.advertised(phone.advert(daemon.lanPort));

      await _waitFor(
        () => phone.connectedOverLan,
        'the phone to find the daemon on its new port',
      );
      final discovered = '127.0.0.1:${daemon.lanPort}';
      expect(
        storedLan.any((lan) => lan.isNotEmpty && lan.first == discovered),
        isTrue,
        reason: 'the route discovery found is what the record leads with',
      );
      expect(
        phone.machine.lan.any((route) => route.endsWith(':${daemon.lanPort}')),
        isTrue,
        reason: 'the record holds the port the daemon came back on',
      );
      expect(firstPort, isNot(daemon.lanPort), reason: 'the daemon moved');
    },
    timeout: const Timeout(Duration(seconds: 300)),
  );
}
