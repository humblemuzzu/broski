import 'dart:async';
import 'dart:math';

import 'package:test/test.dart';

import 'bridge_session.dart';
import 'link_phone.dart';
import 'real_bridge.dart';

/// Real requests at a fixed pace, with a forced redial every [redialEvery].
///
/// Each request's round trip is filed under the phase it was sent in, so a
/// soak can report LAN and relay latency apart. Missed slots are skipped, never
/// replayed, so a route change cannot turn into a burst.
final class SoakLoad {
  SoakLoad(
    this._phone,
    this._session, {
    this.pacing = const Duration(milliseconds: 50),
    this.redialEvery = const Duration(seconds: 20),
  });

  final LinkPhone _phone;
  final BridgeSession _session;
  final Duration pacing;
  final Duration redialEvery;
  final Map<String, List<int>> latencies = <String, List<int>>{};
  final Completer<void> _stopped = Completer<void>();

  /// The phase new requests are filed under.
  String phase = 'setup';

  int requests = 0;
  int redials = 0;
  int failures = 0;

  bool _running = false;

  void start() {
    _running = true;
    unawaited(_loop());
  }

  Future<void> stop() async {
    if (!_running) {
      return;
    }
    _running = false;
    await _stopped.future;
  }

  Future<void> _loop() async {
    var next = DateTime.now();
    var redialAt = next.add(redialEvery);
    while (_running) {
      await _send();
      final now = DateTime.now();
      next = (now.isAfter(next) ? now : next).add(pacing);
      if (now.isAfter(redialAt)) {
        _phone.networkChanged();
        redials++;
        redialAt = now.add(redialEvery);
      }
      if (DateTime.now().isBefore(next)) {
        await Future<void>.delayed(next.difference(DateTime.now()));
      }
    }
    _stopped.complete();
  }

  Future<void> _send() async {
    final key = _session.key();
    final message = requests.isEven
        ? clientPing(key, DateTime.now().millisecondsSinceEpoch)
        : listDevices(key);
    final label = phase;
    requests++;
    final clock = Stopwatch()..start();
    try {
      await _session.request(message, timeout: const Duration(seconds: 30));
      (latencies[label] ??= <int>[]).add(clock.elapsedMicroseconds);
    } on TimeoutException {
      failures++;
    }
  }
}

typedef RssSample = ({Duration at, Map<String, int> rss});

/// Samples the resident set of the daemon, the relay and the bridge.
final class RssSampler {
  RssSampler({required this.pids, this.interval = const Duration(seconds: 30)});

  final Map<String, int> pids;
  final Duration interval;
  final List<RssSample> samples = <RssSample>[];
  final Stopwatch _clock = Stopwatch();
  Timer? _timer;

  void start() {
    _clock.start();
    _timer = Timer.periodic(interval, (_) => unawaited(_sample()));
  }

  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    _clock.stop();
    await _sample();
  }

  Future<void> _sample() async {
    final rss = <String, int>{};
    for (final entry in pids.entries) {
      final value = await rssKb(entry.value);
      if (value != null) {
        rss[entry.key] = value;
      }
    }
    samples.add((at: _clock.elapsed, rss: rss));
  }

  /// Fails when any process sat more than [allowed] above its reading at the
  /// end of the warm-up.
  void assertStable({
    Duration warmUp = const Duration(minutes: 1),
    double allowed = 0.5,
  }) {
    final baseline = samples.lastWhere(
      (sample) => sample.at <= warmUp,
      orElse: () => samples.first,
    );
    final late = samples.where((sample) => sample.at > baseline.at);
    for (final sample in late) {
      for (final entry in sample.rss.entries) {
        final start = baseline.rss[entry.key];
        if (start == null) {
          continue;
        }
        expect(
          entry.value,
          lessThanOrEqualTo((start * (1 + allowed)).round()),
          reason:
              '${entry.key} went from $start KiB at '
              '${baseline.at.inSeconds}s to ${entry.value} KiB at '
              '${sample.at.inSeconds}s\n${report()}',
        );
      }
    }
  }

  /// One line per process: its RSS in KiB at each sample.
  String report() => <String>[
    for (final label in pids.keys)
      '$label(KiB) ${samples.map((s) => '${s.at.inSeconds}s:${s.rss[label] ?? '-'}').join(' ')}',
  ].join('\n');
}

typedef Latencies = ({
  int count,
  double p50,
  double p99,
  double min,
  double max,
});

/// Milliseconds at the p50, p99, min and max of [microseconds].
Latencies latencyStats(List<int> microseconds) {
  final sorted = List<int>.of(microseconds)..sort();
  if (sorted.isEmpty) {
    return (count: 0, p50: 0, p99: 0, min: 0, max: 0);
  }
  double at(double fraction) =>
      sorted[((sorted.length - 1) * fraction).round()] / 1000;
  return (
    count: sorted.length,
    p50: at(0.5),
    p99: at(0.99),
    min: sorted.first / 1000,
    max: sorted.last / 1000,
  );
}

/// [count] message indexes to redial on, spread over a stream of [total], in
/// order and deterministic in [seed].
List<int> redialSlots(int total, int count, {int seed = 7}) {
  final random = Random(seed);
  final slots = <int>{};
  while (slots.length < count) {
    slots.add(1 + random.nextInt(total - 2));
  }
  return slots.toList()..sort();
}
