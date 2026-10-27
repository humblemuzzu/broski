import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:broski/services/link/discovery/discovery_scheduler.dart';
import 'package:broski/services/link/discovery/link_discovery.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

/// A browser that answers with whatever the test queued, and records the window
/// it was asked for.
class _FakeBrowser implements LinkServiceBrowser {
  _FakeBrowser(this.answers);

  List<DiscoveredLink> answers;
  Object? throws;
  final List<Duration> windows = [];
  var browsed = 0;

  @override
  Future<List<DiscoveredLink>> browse({required Duration window}) async {
    browsed++;
    windows.add(window);
    final failure = throws;
    if (failure != null) throw failure;
    return answers;
  }
}

const _machineId = '0123456789abcdef0123456789abcdef';

DiscoveredLink _advert(String machineId, String host, int port) =>
    DiscoveredLink(machineId: machineId, host: host, port: port);

void main() {
  group('DiscoveredLink', () {
    test('reads the machine id and version out of the TXT record', () {
      final link = DiscoveredLink.fromAdvertisement(
        attributes: const {'id': _machineId, 'v': '1'},
        host: '192.168.1.20',
        port: 47821,
      );

      expect(link?.machineId, _machineId);
      expect(link?.route, '192.168.1.20:47821');
    });

    test('drops an advert that names no machine or another version', () {
      expect(
        DiscoveredLink.fromAdvertisement(
          attributes: const {'v': '1'},
          host: '192.168.1.20',
          port: 47821,
        ),
        isNull,
      );
      expect(
        DiscoveredLink.fromAdvertisement(
          attributes: const {'id': _machineId, 'v': '2'},
          host: '192.168.1.20',
          port: 47821,
        ),
        isNull,
      );
      expect(
        DiscoveredLink.fromAdvertisement(
          attributes: const {'id': _machineId, 'v': '1'},
          host: null,
          port: 47821,
        ),
        isNull,
      );
    });
  });

  group('LinkDiscovery', () {
    late List<List<String>> persisted;

    setUp(() => persisted = []);

    LinkDiscovery discoveryWith(LinkServiceBrowser browser) => LinkDiscovery(
      browser: browser,
      machineId: _machineId,
      persist: (routes) async => persisted.add(routes),
    );

    test('keeps only what the machine itself advertises', () async {
      final browser = _FakeBrowser([
        _advert(_machineId, '192.168.1.20', 47821),
        _advert('ffffffffffffffffffffffffffffffff', '192.168.1.99', 47821),
      ]);

      expect(await discoveryWith(browser).run(), ['192.168.1.20:47821']);
      expect(persisted, [
        ['192.168.1.20:47821'],
      ]);
    });

    test('persists nothing when the machine did not answer', () async {
      final browser = _FakeBrowser([
        _advert('ffffffffffffffffffffffffffffffff', '192.168.1.99', 47821),
      ]);

      expect(await discoveryWith(browser).run(), isEmpty);
      expect(persisted, isEmpty);
    });

    test('hands the browse its bounded window', () async {
      final browser = _FakeBrowser(const []);

      await discoveryWith(browser).run();

      expect(browser.windows, [linkDiscoveryWindow]);
    });

    test('many adverts for the machine all become routes', () async {
      final browser = _FakeBrowser([
        _advert(_machineId, '192.168.1.20', 47821),
        _advert(_machineId, '10.0.0.7', 47821),
      ]);

      expect(await discoveryWith(browser).run(), [
        '192.168.1.20:47821',
        '10.0.0.7:47821',
      ]);
    });

    test('a second ask joins the browse already running', () async {
      final browser = _FakeBrowser([
        _advert(_machineId, '192.168.1.20', 47821),
      ]);
      final discovery = discoveryWith(browser);

      final results = await Future.wait([discovery.run(), discovery.run()]);

      expect(browser.browsed, 1);
      expect(results.first, results.last);
    });

    test(
      'a browse that throws finds nothing instead of failing the caller',
      () async {
        final browser = _FakeBrowser(const [])..throws = StateError('no radio');

        expect(await discoveryWith(browser).run(), isEmpty);
        expect(persisted, isEmpty);
      },
    );
  });

  group('when a browse can help', () {
    test('not while the link is already on the LAN', () {
      expect(browseHelps(connected: true, route: LinkRoute.lan), isFalse);
    });

    test(
      'while the link is retrying, or on the relay, or not connected at all',
      () {
        expect(browseHelps(connected: true, route: LinkRoute.relay), isTrue);
        expect(browseHelps(connected: false, route: null), isTrue);
        expect(browseHelps(connected: false, route: LinkRoute.relay), isTrue);
      },
    );
  });

  group('DiscoveryScheduler', () {
    test('looks once, then not again inside the interval', () {
      var now = Duration.zero;
      final scheduler = DiscoveryScheduler(
        clock: () => now,
        interval: const Duration(minutes: 30),
      );

      expect(scheduler.due(), isTrue);
      scheduler.record();
      expect(scheduler.due(), isFalse);

      now = const Duration(minutes: 29);
      expect(scheduler.due(), isFalse);

      now = const Duration(minutes: 30);
      expect(scheduler.due(), isTrue);
    });
  });
}
