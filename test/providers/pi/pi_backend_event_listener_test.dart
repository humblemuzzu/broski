import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi/pi_backend_event_listener.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeBackendEvent backendEvent(String kind, Map<String, dynamic>? payload) {
  return RuntimeEvent.fromJson(<String, dynamic>{
        'type': 'backend_event',
        'backend': 'pi',
        'timestampMs': 1000,
        'sessionId': 'pi-1',
        'seq': 1,
        'kind': kind,
        'payload': payload,
      })
      as RuntimeBackendEvent;
}

void main() {
  group('Pi backend event thinking level', () {
    test('reads the level carried by the event', () {
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('thinking-level-changed', {'level': 'xhigh'}),
        ),
        PiThinkingLevel.xhigh,
      );
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('thinking-level-changed', {'level': 'minimal'}),
        ),
        PiThinkingLevel.minimal,
      );
    });

    test('defaults an unknown wire level to medium', () {
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('thinking-level-changed', {'level': 'turbo'}),
        ),
        PiThinkingLevel.medium,
      );
    });

    test('returns null when the event carries no usable level', () {
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('thinking-level-changed', null),
        ),
        isNull,
      );
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('thinking-level-changed', {'level': 3}),
        ),
        isNull,
      );
      expect(
        piThinkingLevelFromBackendEvent(
          backendEvent('queue-update', {'steering': [], 'followUp': []}),
        ),
        isNull,
      );
    });
  });
}
