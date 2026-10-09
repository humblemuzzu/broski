import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi/pi_live_queue_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeBackendEvent queueUpdate({
  required List<String> steering,
  required List<String> followUp,
  String? sessionId = 'pi-1',
  int seq = 1,
}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
        'type': 'backend_event',
        'backend': 'pi',
        'timestampMs': 1000 + seq,
        if (sessionId != null) 'sessionId': sessionId,
        'seq': seq,
        'kind': 'queue-update',
        'payload': {'steering': steering, 'followUp': followUp},
      })
      as RuntimeBackendEvent;
}

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  PiLiveQueueNotifier notifier() =>
      container.read(piLiveQueueProvider.notifier);

  Map<String, PiQueueState> queues() => container.read(piLiveQueueProvider);

  group('Pi live queue', () {
    test('keeps steering and follow-up messages per session', () {
      notifier().applyQueueUpdate(
        queueUpdate(steering: ['steer a'], followUp: ['follow up']),
      );

      final queue = queues()['pi-1'];
      expect(queue?.total, 2);
      expect(queue?.steering, ['steer a']);
      expect(queue?.followUp, ['follow up']);
    });

    test('an empty update clears the queue for that session', () {
      notifier().applyQueueUpdate(
        queueUpdate(steering: ['steer a'], followUp: const []),
      );
      expect(queues()['pi-1']?.total, 1);

      notifier().applyQueueUpdate(
        queueUpdate(steering: const [], followUp: const [], seq: 2),
      );

      expect(queues()['pi-1']?.total, 0);
    });

    test('does not mix sessions', () {
      notifier().applyQueueUpdate(
        queueUpdate(steering: ['for pi-1'], followUp: const []),
      );
      notifier().applyQueueUpdate(
        queueUpdate(
          steering: const [],
          followUp: ['for pi-2', 'and another'],
          sessionId: 'pi-2',
          seq: 2,
        ),
      );

      expect(queues()['pi-1']?.total, 1);
      expect(queues()['pi-2']?.total, 2);
    });

    test('ignores an update without a session id', () {
      notifier().applyQueueUpdate(
        queueUpdate(steering: ['orphan'], followUp: const [], sessionId: null),
      );

      expect(queues(), isEmpty);
    });
  });
}
