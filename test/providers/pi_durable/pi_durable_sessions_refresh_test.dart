import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi_durable/pi_durable_sessions_refresh.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeEvent pdEvent(String type, {Map<String, dynamic> extra = const {}}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
    'type': type,
    'backend': 'pi-durable',
    'timestampMs': 1000,
    'sessionId': 'pd-session-1',
    'cwd': '/Users/dev/app',
    ...extra,
  });
}

void main() {
  group('piDurableEventChangesSessions', () {
    test('accepts the events that change a durable session row', () {
      expect(piDurableEventChangesSessions(pdEvent('agent_finished')), isTrue);
      expect(
        piDurableEventChangesSessions(
          pdEvent(
            'session_state_changed',
            extra: {
              'state': {'backend': 'pi-durable', 'sessionId': 'pd-session-1'},
            },
          ),
        ),
        isTrue,
      );
      expect(
        piDurableEventChangesSessions(
          pdEvent(
            'backend_event',
            extra: {
              'kind': 'submission',
              'payload': {'id': 8, 'status': 'done'},
            },
          ),
        ),
        isTrue,
      );
    });

    test('ignores durable events that cannot change the row', () {
      for (final kind in [
        'queue-update',
        'usage_changed',
        'resumed',
        'entry_appended',
        'agent_changed',
      ]) {
        expect(
          piDurableEventChangesSessions(
            pdEvent('backend_event', extra: {'kind': kind}),
          ),
          isFalse,
          reason: kind,
        );
      }
      expect(
        piDurableEventChangesSessions(
          pdEvent('assistant_text_delta', extra: {'delta': 'x'}),
        ),
        isFalse,
      );
      expect(piDurableEventChangesSessions(pdEvent('tool_started')), isFalse);
      expect(piDurableEventChangesSessions(pdEvent('agent_started')), isFalse);
    });

    test('ignores every other backend', () {
      for (final backend in ['pi', 'opencode', 'claude-code', 'codex']) {
        final event = RuntimeEvent.fromJson({
          'type': 'agent_finished',
          'backend': backend,
          'timestampMs': 1000,
          'sessionId': 's-1',
        });
        expect(piDurableEventChangesSessions(event), isFalse, reason: backend);
      }
    });
  });

  group('PiDurableSessionsRefresher', () {
    test('coalesces a burst of events into one refresh', () async {
      var refreshes = 0;
      final refresher = PiDurableSessionsRefresher(
        onRefresh: () => refreshes++,
        debounce: const Duration(milliseconds: 20),
      );

      refresher.schedule(pdEvent('agent_finished'));
      refresher.schedule(
        pdEvent(
          'backend_event',
          extra: {
            'kind': 'submission',
            'payload': {'id': 8, 'status': 'done'},
          },
        ),
      );
      refresher.schedule(
        pdEvent(
          'session_state_changed',
          extra: {
            'state': {'backend': 'pi-durable', 'sessionId': 'pd-session-1'},
          },
        ),
      );
      expect(refreshes, 0);

      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(refreshes, 1);
      refresher.dispose();
    });

    test('an ignored event never schedules a refresh', () async {
      var refreshes = 0;
      final refresher = PiDurableSessionsRefresher(
        onRefresh: () => refreshes++,
        debounce: const Duration(milliseconds: 20),
      );

      refresher.schedule(pdEvent('tool_started'));
      refresher.schedule(
        pdEvent('backend_event', extra: {'kind': 'usage_changed'}),
      );

      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(refreshes, 0);
      refresher.dispose();
    });

    test('dispose cancels a pending refresh', () async {
      var refreshes = 0;
      final refresher = PiDurableSessionsRefresher(
        onRefresh: () => refreshes++,
        debounce: const Duration(milliseconds: 20),
      );

      refresher.schedule(pdEvent('agent_finished'));
      refresher.dispose();

      await Future<void>.delayed(const Duration(milliseconds: 60));
      expect(refreshes, 0);
    });
  });
}
