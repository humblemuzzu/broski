import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../link/fake_lan_browse.dart';

const _machineId = '0123456789abcdef0123456789abcdef';
const _otherId = 'ffffffffffffffffffffffffffffffff';

DiscoveredLink _advert(String machineId, String host, int port) =>
    DiscoveredLink(machineId: machineId, host: host, port: port);

final class _RecordingSink implements LanSearchSink {
  final List<List<String>> pushed = <List<String>>[];
  final List<LanSearchState> states = <LanSearchState>[];
  final List<Object?> errors = <Object?>[];

  @override
  void routes(List<String> routes) => pushed.add(routes);

  @override
  void state(LanSearchState state) => states.add(state);

  @override
  void failed(Object error) => errors.add(error);
}

void main() {
  late FakeLanBrowser browser;
  late FakeLanTiming timing;
  late _RecordingSink sink;

  LanSearch searchWith({String machineId = _machineId}) => LanSearch(
    browser: browser,
    machineId: machineId,
    sink: sink,
    timing: timing,
  );

  setUp(() {
    browser = FakeLanBrowser();
    timing = FakeLanTiming();
    sink = _RecordingSink();
  });

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

  group('a browse for the machine', () {
    test('looks from the moment it starts', () {
      final search = searchWith()..start();

      expect(search.running, isTrue);
      expect(sink.states, [LanSearchState.looking]);
      expect(timing.waiting, lanAbsentVerdictDelay);
    });

    test('says the machine is offline once nothing is advertised', () async {
      final search = searchWith()..start();

      timing.fire();
      await pumpEventQueue();

      expect(search.state, LanSearchState.absent);
    });

    test('a route the machine advertises is handed over', () async {
      searchWith().start();

      browser.advertised(_advert(_machineId, '192.168.1.20', 47821));
      await pumpEventQueue();

      expect(sink.pushed, [
        ['192.168.1.20:47821'],
      ]);
      expect(sink.states, [LanSearchState.looking, LanSearchState.quiet]);
      expect(timing.waiting, isNull, reason: 'the machine answered');
    });

    test('every address it advertises is offered, newest first', () async {
      searchWith().start();

      browser.advertised(_advert(_machineId, '192.168.1.20', 47821));
      await pumpEventQueue();
      browser.advertised(_advert(_machineId, '10.0.0.7', 47821));
      await pumpEventQueue();

      expect(sink.pushed.last, ['10.0.0.7:47821', '192.168.1.20:47821']);
    });

    test('an advert for another machine is not a route', () async {
      searchWith().start();

      browser.advertised(_advert(_otherId, '192.168.1.99', 47821));
      await pumpEventQueue();

      expect(sink.pushed, isEmpty);
      expect(sink.states, [LanSearchState.looking]);
    });

    test(
      'a route reported again inside the redial window is not pushed',
      () async {
        searchWith().start();
        final link = _advert(_machineId, '192.168.1.20', 47821);

        browser.advertised(link);
        await pumpEventQueue();
        browser.unadvertised(link);
        browser.advertised(link);
        await pumpEventQueue();

        expect(sink.pushed, hasLength(1));
      },
    );

    test('a route that comes back later is offered again', () async {
      searchWith().start();
      final link = _advert(_machineId, '192.168.1.20', 47821);

      browser.advertised(link);
      await pumpEventQueue();
      browser.unadvertised(link);
      timing.elapsed += lanRouteRedialInterval;
      browser.advertised(link);
      await pumpEventQueue();

      expect(sink.pushed, hasLength(2));
    });

    test('an advert going away never pushes a route of its own', () async {
      final search = searchWith()..start();
      final link = _advert(_machineId, '192.168.1.20', 47821);

      browser.advertised(link);
      await pumpEventQueue();
      browser.unadvertised(link);
      await pumpEventQueue();

      expect(sink.pushed, hasLength(1));
      expect(search.state, LanSearchState.looking);
      expect(timing.waiting, lanAbsentVerdictDelay);
    });

    test(
      'a browse that cannot run reports the reason and claims nothing',
      () async {
        final search = searchWith()..start();

        browser.failed(StateError('no radio'));
        await pumpEventQueue();

        expect(sink.errors, hasLength(1));
        expect(sink.states, [LanSearchState.looking, LanSearchState.quiet]);
        expect(timing.waiting, isNull);
        expect(search.state, LanSearchState.quiet);
      },
    );

    test('stopping clears the routes and claims nothing', () async {
      final search = searchWith()..start();
      browser.advertised(_advert(_machineId, '192.168.1.20', 47821));
      await pumpEventQueue();

      search.stop();

      expect(search.running, isFalse);
      expect(search.state, LanSearchState.quiet);
      expect(timing.waiting, isNull);
    });
  });

  group('when a browse can help', () {
    test('not while the link carries the machine', () {
      const connected = LinkStatus(
        state: LinkConnectionState.connected,
        route: LinkRoute.lan,
      );

      expect(lanSearchWanted(foreground: true, status: connected), isFalse);
    });

    test('while the link is dialling, retrying or parked', () {
      for (final state in <LinkConnectionState>[
        LinkConnectionState.connecting,
        LinkConnectionState.waiting,
        LinkConnectionState.machineOffline,
        LinkConnectionState.machineAsleep,
      ]) {
        expect(
          lanSearchWanted(foreground: true, status: LinkStatus(state: state)),
          isTrue,
          reason: '$state',
        );
      }
      expect(lanSearchWanted(foreground: true, status: null), isTrue);
    });

    test('not in the background, and not for a machine that removed us', () {
      const revoked = LinkStatus(
        state: LinkConnectionState.closed,
        closeCode: LinkCloseCode.revoked,
      );

      expect(lanSearchWanted(foreground: false, status: null), isFalse);
      expect(lanSearchWanted(foreground: true, status: revoked), isFalse);
    });
  });

  group('the record routes', () {
    test('put what is advertising now in front of what worked before', () {
      expect(mergeLanRoutes(['10.0.0.7:47821'], ['192.168.1.20:47821']), [
        '10.0.0.7:47821',
        '192.168.1.20:47821',
      ]);
    });

    test('keep one entry per address and stay bounded', () {
      final merged = mergeLanRoutes(
        ['a:1', 'b:1', 'a:1'],
        ['c:1', 'd:1', 'e:1', 'b:1', 'f:1'],
      );

      expect(merged, ['a:1', 'b:1', 'c:1', 'd:1']);
      expect(merged, hasLength(lanRouteHistoryMax));
    });
  });
}
