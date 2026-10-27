@Tags(['e2e'])
library;

import 'dart:io';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'bridge_session.dart';
import 'lan_forwarder.dart';
import 'link_sandbox.dart';
import 'pairing_flows.dart';
import 'real_bridge.dart';
import 'real_machine.dart';
import 'soak_harness.dart';

const Timeout _budget = Timeout(Duration(seconds: 600));

void main() {
  test('round-trips real bridge requests over a link-paired phone', () async {
    final machine = await startMachine();
    final session = machine.session;

    final pong = await session.request(
      clientPing(session.key(), DateTime.now().millisecondsSinceEpoch),
    );
    expect(pong['type'], 'client_pong');
    expect(pong['receivedAt'], isA<int>());

    final echo = await session.request(
      registerDevice(
        session.key(),
        deviceId: machine.deviceId,
        deviceName: 'e2e phone',
        platform: 'ios',
      ),
    );
    expect(echo['type'], 'device_registered');
    expect((echo['data']! as Map)['deviceId'], machine.deviceId);

    expect(
      await bridgeDeviceIds(session),
      contains(machine.deviceId),
      reason: 'the bridge lists the paired companion',
    );
    expectCleanReplies(session);
  }, timeout: _budget);

  test(
    'survives the bridge crashing and coming back without re-pairing',
    () async {
      final machine = await startMachine();
      final phone = machine.phone;
      final session = machine.session;

      final first = await session.request(clientPing(session.key(), 1));
      expect(first['type'], 'client_pong');

      final from = phone.bridgeStates.length;
      final firstPid = machine.bridge.pid;
      await machine.bridge.crash();
      await phone.awaitBridgeState('crashed', from: from);

      final queued = session.request(clientPing(session.key(), 2));
      await phone.awaitBridgeState('starting', from: from);
      await phone.awaitBridgeState('up', from: from);
      expect(
        phone.bridgeStates.sublist(from),
        containsAllInOrder(<String>['crashed', 'starting', 'up']),
        reason: 'the crash, the restart and the recovery reach the phone',
      );

      final restarted = await RealBridge.up(machine.sandbox);
      expect(
        restarted.pid,
        isNot(firstPid),
        reason: 'a new bridge process ran',
      );

      expect((await queued)['type'], 'client_pong');
      expect(
        (await session.request(clientPing(session.key(), 3)))['type'],
        'client_pong',
        reason: 'requests work again without pairing again',
      );
      expect(
        phone.statuses.where((status) => status.sessionReset),
        isEmpty,
        reason: 'the link session outlived the bridge',
      );
      expectCleanReplies(session);
    },
    timeout: _budget,
  );

  test(
    'resumes five redials mid-stream with every reply exactly once',
    () async {
      final machine = await startMachine();
      final phone = machine.phone;
      final session = machine.session;

      const total = 120;
      final slots = redialSlots(total, 5).toSet();
      final replies = <Future<Map<String, Object?>>>[];

      for (var index = 0; index < total; index++) {
        replies.add(
          session.request(
            index.isEven
                ? clientPing(session.key(), index)
                : listDevices(session.key()),
          ),
        );
        if (!slots.contains(index)) {
          continue;
        }
        final from = phone.statusCount;
        phone.networkChanged();
        final resumed = await phone.awaitStatus(
          (status) =>
              status.state == LinkConnectionState.connected &&
              status.resumed == true,
          from: from,
          reason: 'a resumed handshake after the redial at request $index',
        );
        expect(resumed.route, LinkRoute.lan);
      }

      expect((await Future.wait(replies)).length, total);
      expect(session.answered, total);
      expectCleanReplies(session);
    },
    timeout: _budget,
  );

  test('soaks the real bridge across two LAN to relay switches', () async {
    final sandbox = await LinkSandbox.create();
    final environment = sandboxEnvironment(sandbox);
    await sandbox.startRelay(environment: environment);
    await sandbox.startDaemon(
      relay: true,
      bridgeCmd: await realBridgeCommand(),
      environment: environment,
    );
    final bridge = await RealBridge.up(sandbox);
    final relay = sandbox.relay!;
    final forwarder = await LanForwarder.start(sandbox.lanPort!);
    addTearDown(forwarder.close);

    final identity = LinkIdentity.generate();
    final paired = await pairOverLan(
      sandbox,
      identity,
      candidate: forwarder.candidate,
    );
    expect(paired.connected.route, LinkRoute.lan);
    final phone = paired.phone;
    final session = BridgeSession(phone);
    addTearDown(session.dispose);

    MachineEndpoint endpoint() => MachineEndpoint(
      machineId: paired.machineId,
      serverPublicBundle: paired.bundle,
      deviceId: identity.id,
      lan: <String>[forwarder.candidate],
      relay: relay,
      relayToken: paired.token,
    );

    final sampler = RssSampler(
      pids: <String, int>{
        'daemon': sandbox.daemonPid!,
        'relay': sandbox.relayPid!,
        'bridge': bridge.pid,
      },
    )..start();
    phone.updateEndpoint(endpoint());
    final load = SoakLoad(phone, session)..start();

    Future<void> phase(String label) async {
      load.phase = label;
      await Future<void>.delayed(const Duration(seconds: 40));
    }

    await phase('lan');
    for (var round = 0; round < 2; round++) {
      final off = phone.statusCount;
      forwarder.cut();
      await phone.awaitRoute(
        LinkRoute.relay,
        from: off,
        timeout: const Duration(seconds: 45),
      );
      await phase('relay');

      final on = phone.statusCount;
      forwarder.restore();
      phone.updateEndpoint(endpoint());
      await phone.awaitRoute(
        LinkRoute.lan,
        from: on,
        timeout: const Duration(seconds: 45),
      );
      await phase('lan');
    }
    await load.stop();
    await sampler.stop();

    final lan = latencyStats(load.latencies['lan'] ?? const <int>[]);
    final byRelay = latencyStats(load.latencies['relay'] ?? const <int>[]);
    stdout.writeln(
      'soak: ${load.requests} requests, ${session.answered} answered, '
      '${load.redials} redials, ${load.failures} unanswered; '
      'lan p50 ${lan.p50} ms p99 ${lan.p99} ms '
      'min ${lan.min} ms max ${lan.max} ms (n=${lan.count}); '
      'relay p50 ${byRelay.p50} ms p99 ${byRelay.p99} ms '
      'min ${byRelay.min} ms max ${byRelay.max} ms (n=${byRelay.count})',
    );
    stdout.writeln(sampler.report());

    expect(load.failures, 0, reason: 'no request went unanswered');
    expect(lan.count, greaterThan(100));
    expect(byRelay.count, greaterThan(100));
    expect(load.redials, greaterThanOrEqualTo(7));
    expectCleanReplies(session);
    sampler.assertStable();
  }, timeout: _budget);
}
