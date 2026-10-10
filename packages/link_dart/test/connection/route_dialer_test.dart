import 'dart:async';

import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/route_dialer.dart';
import 'package:test/test.dart';

import 'fake_socket.dart';

/// Collects the callbacks the dialer schedules, so the grace window is fired
/// by the test rather than by a timer.
final class FakeScheduler {
  final List<({Duration delay, void Function() callback})> pending = [];

  void call(Duration delay, void Function() callback) =>
      pending.add((delay: delay, callback: callback));

  void fire() {
    final entry = pending.removeAt(0);
    entry.callback();
  }
}

/// A dial that picks the fake by route.
Future<LinkSocket> byRoute(
  Dial relay,
  Dial lan, {
  required Uri uri,
  required LinkRoute route,
  required Duration timeout,
}) => route == LinkRoute.relay
    ? relay.call(uri: uri, route: route, timeout: timeout)
    : lan.call(uri: uri, route: route, timeout: timeout);

void main() {
  test('a relay that opens alone is chosen immediately', () async {
    final scheduler = FakeScheduler();
    final relay = FakeSocket(
      LinkRoute.relay,
      Uri.parse('ws://relay/v1/device'),
    );
    final dial = Dial(relay);
    LinkSocket? chosen;
    var exhausted = false;

    RouteDialer(dial: dial.call, schedule: scheduler.call).start(
      lan: const <Uri>[],
      relay: relay.uri,
      onChosen: (socket) => chosen = socket,
      onExhausted: () => exhausted = true,
    );
    dial.open();
    await pumpEventQueue();

    expect(chosen, same(relay));
    expect(exhausted, isFalse);
    expect(scheduler.pending, isEmpty, reason: 'no LAN candidate to wait for');
  });

  test(
    'a LAN socket inside the grace window wins and closes the relay',
    () async {
      final scheduler = FakeScheduler();
      final relay = FakeSocket(
        LinkRoute.relay,
        Uri.parse('ws://relay/v1/device'),
      );
      final lan = FakeSocket(
        LinkRoute.lan,
        Uri.parse('ws://10.0.0.4:9/v1/link'),
      );
      final relayDial = Dial(relay);
      final lanDial = Dial(lan);
      LinkSocket? chosen;

      RouteDialer(
        dial: ({required uri, required route, required timeout}) => byRoute(
          relayDial,
          lanDial,
          uri: uri,
          route: route,
          timeout: timeout,
        ),
        schedule: scheduler.call,
      ).start(
        lan: <Uri>[lan.uri],
        relay: relay.uri,
        onChosen: (socket) => chosen = socket,
        onExhausted: () => fail('no socket opened'),
      );

      relayDial.open();
      await pumpEventQueue();
      expect(chosen, isNull, reason: 'within the grace window');
      expect(scheduler.pending.single.delay, const Duration(milliseconds: 300));

      lanDial.open();
      await pumpEventQueue();
      expect(chosen, same(lan));
      expect(relay.closed, isTrue);
      scheduler.fire();
      expect(chosen, same(lan), reason: 'a fired grace window changes nothing');
    },
  );

  test('the relay wins when the grace window expires first', () async {
    final scheduler = FakeScheduler();
    final relay = FakeSocket(
      LinkRoute.relay,
      Uri.parse('ws://relay/v1/device'),
    );
    final lan = FakeSocket(LinkRoute.lan, Uri.parse('ws://10.0.0.4:9/v1/link'));
    final relayDial = Dial(relay);
    final lanDial = Dial(lan);
    LinkSocket? chosen;

    RouteDialer(
      dial: ({required uri, required route, required timeout}) =>
          byRoute(relayDial, lanDial, uri: uri, route: route, timeout: timeout),
      schedule: scheduler.call,
    ).start(
      lan: <Uri>[lan.uri],
      relay: relay.uri,
      onChosen: (socket) => chosen = socket,
      onExhausted: () => fail('the relay opened'),
    );

    relayDial.open();
    await pumpEventQueue();
    scheduler.fire();
    expect(chosen, same(relay));

    lanDial.open();
    await pumpEventQueue();
    expect(lan.closed, isTrue, reason: 'a late LAN socket is a loser');
    expect(chosen, same(relay));
  });

  test('a relay socket that dies inside the window is not chosen', () async {
    final scheduler = FakeScheduler();
    final relay = FakeSocket(
      LinkRoute.relay,
      Uri.parse('ws://relay/v1/device'),
    );
    final lan = FakeSocket(LinkRoute.lan, Uri.parse('ws://10.0.0.4:9/v1/link'));
    final relayDial = Dial(relay);
    final lanDial = Dial(lan);
    LinkSocket? chosen;
    final dialer = RouteDialer(
      dial: ({required uri, required route, required timeout}) =>
          byRoute(relayDial, lanDial, uri: uri, route: route, timeout: timeout),
      schedule: scheduler.call,
    );
    dialer.start(
      lan: <Uri>[lan.uri],
      relay: relay.uri,
      onChosen: (socket) => chosen = socket,
      onExhausted: () => fail('the LAN candidate opened'),
    );

    relayDial.open();
    await pumpEventQueue();
    dialer.socketFailed(relay);
    scheduler.fire();
    expect(chosen, isNull);

    lanDial.open();
    await pumpEventQueue();
    expect(chosen, same(lan));
  });

  test('receiving nothing at all is reported as exhausted', () async {
    final scheduler = FakeScheduler();
    final lan = FakeSocket(LinkRoute.lan, Uri.parse('ws://10.0.0.4:9/v1/link'));
    final lanDial = Dial(lan);
    var exhausted = false;

    RouteDialer(dial: lanDial.call, schedule: scheduler.call).start(
      lan: <Uri>[lan.uri],
      relay: null,
      onChosen: (socket) => fail('nothing opened'),
      onExhausted: () => exhausted = true,
    );
    expect(exhausted, isFalse, reason: 'the dial is still in flight');

    lanDial.fail();
    await pumpEventQueue();
    expect(exhausted, isTrue);
  });

  test('a cancelled attempt closes the socket that arrives late', () async {
    final scheduler = FakeScheduler();
    final lan = FakeSocket(LinkRoute.lan, Uri.parse('ws://10.0.0.4:9/v1/link'));
    final lanDial = Dial(lan);
    LinkSocket? chosen;
    var exhausted = false;
    final dialer = RouteDialer(dial: lanDial.call, schedule: scheduler.call);
    dialer.start(
      lan: <Uri>[lan.uri],
      relay: null,
      onChosen: (socket) => chosen = socket,
      onExhausted: () => exhausted = true,
    );

    dialer.cancel();
    lanDial.open();
    await pumpEventQueue();
    expect(lan.closed, isTrue);
    expect(chosen, isNull);
    expect(exhausted, isFalse);
  });
}
