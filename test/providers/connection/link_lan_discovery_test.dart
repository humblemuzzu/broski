import 'dart:typed_data';

import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/discovery_provider.dart';
import 'package:broski/providers/link/lan_search_provider.dart';
import 'package:broski/providers/link/link_session_start_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:broski/services/link/link_session_starter.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../link/fake_lan_browse.dart';
import '../../link/fake_link_session.dart';
import '../../link/link_fixtures.dart';

const _machineId = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const _storedRoute = '192.168.1.20:47821';

const _connected = LinkStatus(
  state: LinkConnectionState.connected,
  route: LinkRoute.lan,
  routeDetail: _storedRoute,
);
const _dropped = LinkStatus(state: LinkConnectionState.waiting);
const _revoked = LinkStatus(
  state: LinkConnectionState.closed,
  closeCode: LinkCloseCode.revoked,
);

DiscoveredLink _advert(String host, int port, {String id = _machineId}) =>
    DiscoveredLink(machineId: id, host: host, port: port);

Machine _machine() => Machine(
  id: _machineId,
  name: 'Studio Mac',
  os: 'macOS 26',
  publicBundle: patternBytes(1217),
  fingerprint: patternBytes(32, seed: 7),
  lan: const [_storedRoute],
  pairedAt: DateTime.utc(2026, 1, 2),
);

/// The monitor's own start talks to a platform channel a test has none of.
final class _SilentNetworkMonitor extends NetworkMonitorService {
  @override
  Future<void> startMonitoring() async {}
}

/// The controller with a link that never dials and a browse a test feeds by hand.
final class _Rig {
  _Rig._(this.container, this.session, this.browser, this.timing);

  static Future<_Rig> start({FakeLanTiming? timing}) async {
    final session = FakeLinkSession();
    final browser = FakeLanBrowser();
    final clock = timing ?? FakeLanTiming();
    final container = ProviderContainer(
      overrides: <Override>[
        networkMonitorServiceProvider.overrideWith(
          (ref) => _SilentNetworkMonitor(),
        ),
        deviceIdentityProvider.overrideWith(
          (ref) async => LinkIdentity.generate(),
        ),
        linkSessionStarterProvider.overrideWithValue(_startWith(session)),
        linkServiceBrowserProvider.overrideWithValue(browser),
        lanSearchTimingProvider.overrideWithValue(clock),
      ],
    );
    final rig = _Rig._(container, session, browser, clock);
    addTearDown(container.dispose);
    container.read(linkConnectionControllerProvider);
    await container.read(machinesProvider.notifier).add(_machine());
    await pumpEventQueue();
    return rig;
  }

  final ProviderContainer container;
  final FakeLinkSession session;
  final FakeLanBrowser browser;
  final FakeLanTiming timing;

  LinkConnectionController get controller =>
      container.read(linkConnectionControllerProvider);

  List<String> get storedLan =>
      container.read(machinesProvider).machines.single.lan;

  LanSearchState get search => container.read(lanSearchProvider);

  Future<void> report(LinkStatus status) async {
    session.report(status);
    await pumpEventQueue();
  }
}

LinkSessionStarter _startWith(FakeLinkSession session) =>
    ({
      required Uint8List identitySecret,
      required MachineEndpoint endpoint,
      Uint8List? pairingSecret,
    }) async => session;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  test('a dial starts the browse, and a working link stops it', () async {
    final rig = await _Rig.start();

    expect(rig.browser.listening, 1, reason: 'nothing has answered yet');

    await rig.report(_connected);

    expect(rig.browser.listening, 0, reason: 'the link is on the LAN');
  });

  test('a link that drops looks for the machine again', () async {
    final rig = await _Rig.start();
    await rig.report(_connected);

    await rig.report(_dropped);

    expect(rig.browser.listening, 1);
    expect(rig.search, LanSearchState.looking);
  });

  test('a route found while the link is down is dialled at once', () async {
    final rig = await _Rig.start();
    await rig.report(_connected);
    await rig.report(_dropped);
    final before = rig.session.endpoints.length;

    rig.browser.advertised(_advert('192.168.1.20', 18299));
    await pumpEventQueue();

    expect(rig.session.endpoints, hasLength(before + 1));
    expect(rig.session.lastEndpoint?.lan.first, '192.168.1.20:18299');
    expect(
      rig.timing.elapsed,
      Duration.zero,
      reason:
          'no backoff was waited out before the link was told where to dial',
    );
  });

  test('what is found goes in the record, in front of what worked', () async {
    final rig = await _Rig.start();
    await rig.report(_dropped);

    rig.browser.advertised(_advert('192.168.1.20', 18299));
    await pumpEventQueue();

    expect(rig.storedLan, ['192.168.1.20:18299', _storedRoute]);
  });

  test('every address the machine advertises is raced', () async {
    final rig = await _Rig.start();
    await rig.report(_dropped);

    rig.browser.advertised(_advert('192.168.1.20', 18299));
    await pumpEventQueue();
    rig.browser.advertised(_advert('10.0.0.7', 18299));
    await pumpEventQueue();

    expect(rig.session.lastEndpoint?.lan, [
      '10.0.0.7:18299',
      '192.168.1.20:18299',
      _storedRoute,
    ]);
  });

  test('an advert naming another machine changes nothing', () async {
    final rig = await _Rig.start();
    await rig.report(_dropped);
    final before = rig.session.endpoints.length;

    rig.browser.advertised(
      _advert('192.168.1.99', 18299, id: 'ffffffffffffffffffffffffffffffff'),
    );
    await pumpEventQueue();

    expect(rig.storedLan, [_storedRoute]);
    expect(rig.session.endpoints, hasLength(before));
  });

  test('a link that removed us does not browse', () async {
    final rig = await _Rig.start();
    await rig.report(_connected);

    await rig.report(_revoked);

    expect(rig.browser.listening, 0);
    expect(rig.search, LanSearchState.quiet);
  });

  test('the background stops the browse, a resume starts it again', () async {
    final rig = await _Rig.start();
    await rig.report(_dropped);
    expect(rig.browser.listening, 1);

    rig.controller.didChangeAppLifecycleState(AppLifecycleState.paused);
    await pumpEventQueue();
    expect(rig.browser.listening, 0);

    rig.controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await pumpEventQueue();
    expect(rig.browser.listening, 1);
  });

  test(
    'nothing advertised for long enough reads as the machine being offline',
    () async {
      final timing = FakeLanTiming();
      final rig = await _Rig.start(timing: timing);
      await rig.report(_dropped);
      expect(rig.search, LanSearchState.looking);

      timing.fire();
      await pumpEventQueue();

      expect(rig.search, LanSearchState.absent);
    },
  );

  test('a browse that cannot run is reported once', () async {
    final rig = await _Rig.start();
    await rig.report(_dropped);
    final reported = <Object?>[];
    final subscription = rig.controller.discoveryFailures.listen(reported.add);
    addTearDown(subscription.cancel);

    rig.browser.failed(StateError('local network denied'));
    await pumpEventQueue();
    rig.browser.failed(StateError('local network denied'));
    await pumpEventQueue();

    expect(reported, hasLength(1));
  });
}
