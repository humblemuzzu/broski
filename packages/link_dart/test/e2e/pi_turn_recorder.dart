import 'dart:async';
import 'dart:convert';

import 'package:test/test.dart';

import 'link_phone.dart';

/// A runtime event the phone received, and how long after the recorder
/// started it arrived.
typedef RecordedEvent = ({Duration at, Map<String, Object?> event});

/// Records the `runtime_event`s a phone receives over the link, as they arrive,
/// so a test can say what the phone had at a given moment of a turn.
final class PiTurnRecorder {
  PiTurnRecorder(LinkPhone phone) {
    _subscription = phone.connection.bridgeMessages.listen(_onText);
    _clock.start();
  }

  final Stopwatch _clock = Stopwatch();
  final List<RecordedEvent> events = [];
  late final StreamSubscription<String> _subscription;

  void _onText(String text) {
    final decoded = jsonDecode(text);
    if (decoded is! Map) return;
    final frames = decoded['type'] == 'batch'
        ? (decoded['messages'] as List<Object?>)
              .whereType<Map<Object?, Object?>>()
        : [decoded];
    for (final frame in frames) {
      if (frame['type'] != 'runtime_event') continue;
      final data = Map<String, Object?>.from(frame['data']! as Map);
      events.add((at: _clock.elapsed, event: data));
    }
  }

  Iterable<Map<String, Object?>> ofType(String type) => [
    for (final recorded in events)
      if (recorded.event['type'] == type) recorded.event,
  ];

  /// Completes with the first event of [type] that passes [where], now or when
  /// it arrives.
  Future<Map<String, Object?>> next(
    String type, {
    bool Function(Map<String, Object?> event)? where,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    bool matches(Map<String, Object?> event) =>
        event['type'] == type && (where?.call(event) ?? true);
    Map<String, Object?>? find() {
      for (final recorded in events) {
        if (matches(recorded.event)) return recorded.event;
      }
      return null;
    }

    final deadline = DateTime.now().add(timeout);
    while (true) {
      final found = find();
      if (found != null) return found;
      if (DateTime.now().isAfter(deadline)) {
        fail(
          'no $type event arrived; saw ${[for (final e in events) e.event['type']]}',
        );
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  /// The text of every `delta` of [type], joined.
  String joined(String type) =>
      ofType(type).map((event) => event['delta']! as String).join();

  Future<void> dispose() async {
    await _subscription.cancel();
  }
}
