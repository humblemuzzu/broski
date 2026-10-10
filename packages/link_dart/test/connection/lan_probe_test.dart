import 'dart:async';

import 'package:broski_link/src/connection/lan_probe.dart';
import 'package:broski_link/src/connection/lan_probe_policy.dart';
import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:test/test.dart';

import 'fake_socket.dart';
import 'wait_for.dart';

/// A probe on its own real clock.
final class ProbeHarness {
  ProbeHarness() {
    probe = LanProbe(
      dial: dial.call,
      onOpened: (socket) => opened = socket,
      clock: () => _clock.elapsed,
      policy: LanProbePolicy(
        interval: const Duration(milliseconds: 100),
        timeout: const Duration(milliseconds: 300),
      ),
    );
  }

  final Stopwatch _clock = Stopwatch()..start();
  final Uri first = Uri.parse('ws://10.0.0.1:1/v1/link');
  final Uri second = Uri.parse('ws://10.0.0.2:1/v1/link');
  final Dial dial = Dial(
    FakeSocket(LinkRoute.lan, Uri.parse('ws://10.0.0.1:1/v1/link')),
  );
  late final LanProbe probe;
  LinkSocket? opened;
}

void main() {
  test(
    'probes candidate by candidate and reports the first that opens',
    () async {
      final harness = ProbeHarness();
      harness.probe.sync(
        eligible: true,
        hosts: <Uri>[harness.first, harness.second],
      );

      await waitFor(() => harness.dial.started == 1);
      await pumpEventQueue();
      expect(harness.dial.timeouts.single, const Duration(milliseconds: 300));
      expect(harness.opened, isNull, reason: 'the first candidate is dialling');

      harness.dial.fail();
      await waitFor(() => harness.dial.started == 2);
      expect(harness.opened, isNull);

      final second = FakeSocket(LinkRoute.lan, harness.second);
      harness.dial.attempts[1].complete(second);
      await waitFor(() => harness.opened == second);
    },
  );

  test('a stop closes a probe that answers afterwards', () async {
    final harness = ProbeHarness();
    harness.probe.sync(eligible: true, hosts: <Uri>[harness.first]);
    await waitFor(() => harness.dial.started == 1);

    harness.probe.stop();
    final late = FakeSocket(LinkRoute.lan, harness.first);
    harness.dial.attempts.single.complete(late);
    await pumpEventQueue();

    expect(late.closed, isTrue);
    expect(harness.opened, isNull);
  });

  test('nothing is dialled while the probe is not eligible', () async {
    final harness = ProbeHarness();
    harness.probe.sync(eligible: false, hosts: <Uri>[harness.first]);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(harness.dial.started, 0);

    harness.probe.sync(eligible: true, hosts: <Uri>[harness.first]);
    await waitFor(() => harness.dial.started == 1);
  });

  test('an empty candidate list stops the probe', () async {
    final harness = ProbeHarness();
    harness.probe.sync(eligible: true, hosts: const <Uri>[]);
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(harness.dial.started, 0);
  });
}
