import 'dart:io';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'fake_machine.dart';
import 'harness.dart';
import 'wait_for.dart';

void main() {
  late FakeMachine machine;

  setUp(() async {
    machine = await FakeMachine.start();
    addTearDown(machine.close);
  });

  test('a LAN candidate inside the grace window carries the link', () async {
    final harness = await startHarness(
      machine,
      lan: <String>[machine.candidate],
    );
    await machine.lanUpgraded;
    expect((await machine.nextLanFrame()).length, 3576);

    final lan = await waitForStatus(
      harness,
      (status) => status.route == LinkRoute.lan,
    );
    expect(lan.routeDetail, machine.candidate);

    await machine.relayUpgraded.timeout(
      const Duration(seconds: 1),
      onTimeout: () {},
    );
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(machine.relayFrames, isEmpty, reason: 'the relay carried nothing');
    expect(machine.relayOpen, isFalse, reason: 'the losing socket is closed');
  });

  test('a refused LAN candidate leaves the relay carrying the link', () async {
    final dead = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = dead.port;
    await dead.close();

    final harness = await startHarness(
      machine,
      lan: <String>['127.0.0.1:$port'],
    );
    await machine.relayUpgraded;
    machine.sendRelayStatus('online');

    expect((await machine.nextRelayFrame()).length, 3576);
    expect(machine.lanFrames, isEmpty);
    final relay = await waitForStatus(
      harness,
      (status) => status.route == LinkRoute.relay,
    );
    expect(relay.routeDetail, '127.0.0.1');
  });

  test('pause drops the socket and resume dials again', () async {
    final harness = await startHarness(machine);
    await machine.relayUpgraded;

    harness.connection.appPaused();
    await machine.relayClosed.timeout(const Duration(seconds: 2));
    expect(machine.relayRequests, 1);
    await waitForStatus(
      harness,
      (status) => status.state == LinkConnectionState.waiting,
    );

    harness.connection.appResumed();
    await waitFor(
      () => machine.relayRequests >= 2,
      reason: 'a fresh dial after the resume',
    );
  });

  test('close ends the streams and drops the sockets', () async {
    final harness = await startHarness(machine);
    await machine.relayUpgraded;

    final closed = harness.connection.status.drain<void>();
    await harness.connection.close();
    await closed.timeout(const Duration(seconds: 2));
    await waitFor(() => !machine.relayOpen, reason: 'the relay socket closed');
    expect(harness.statuses.last.state, LinkConnectionState.closed);
  });
}
