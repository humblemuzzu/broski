import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/sessions/runtime_session_activity_handler.dart';
import 'package:broski/providers/sessions/runtime_session_snapshot_handler.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('runtime session snapshot handler', () {
    test('uses backend status payload when present', () {
      final status = runtimeSessionStatusFromState(
        const RuntimeState(
          backend: AgentType.claudeCode,
          sessionId: 'cc-1',
          backendData: {
            'status': {
              'type': 'retry',
              'attempt': 3,
              'message': 'network',
              'next': 1200,
            },
          },
        ),
      );

      expect(status.isRetry, isTrue);
      expect(status.attempt, 3);
      expect(status.message, 'network');
      expect(status.next, 1200);
    });

    test('derives busy and idle states from normalized flags', () {
      expect(
        runtimeSessionStatusFromState(
          const RuntimeState(
            backend: AgentType.claudeCode,
            sessionId: 'cc-1',
            isStreaming: true,
          ),
        ).isBusy,
        isTrue,
      );

      expect(
        runtimeSessionStatusFromState(
          const RuntimeState(backend: AgentType.claudeCode, sessionId: 'cc-1'),
        ).isIdle,
        isTrue,
      );
    });
  });

  group('runtime session activity handler', () {
    test('extracts session ids and tool names from runtime events', () {
      final event = RuntimeEvent.fromJson({
        'backend': 'claude-code',
        'type': 'tool_started',
        'timestampMs': 10,
        'sessionId': 'cc-1',
        'toolCallId': 'tool-1',
        'toolName': 'Bash',
      });

      expect(runtimeSessionIdFromEvent(event), 'cc-1');
      expect(runtimeToolNameFromEvent(event), 'Bash');
    });

    test('maps normalized events to session statuses', () {
      final retryStatus = runtimeSessionStatusFromEvent(
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'retry_started',
          'timestampMs': 20,
          'sessionId': 'cc-1',
          'attempt': 2,
          'delayMs': 800,
          'errorMessage': 'rate limited',
        }),
      );

      expect(retryStatus?.isRetry, isTrue);
      expect(retryStatus?.attempt, 2);
      expect(retryStatus?.message, 'rate limited');
      expect(retryStatus?.next, 800);

      final stateStatus = runtimeSessionStatusFromEvent(
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'session_state_changed',
          'timestampMs': 30,
          'sessionId': 'cc-1',
          'state': {
            'backend': 'claude-code',
            'sessionId': 'cc-1',
            'isStreaming': true,
          },
        }),
      );

      expect(stateStatus?.isBusy, isTrue);
      expect(
        runtimeSessionStatusFromEvent(
          RuntimeEvent.fromJson({
            'backend': 'claude-code',
            'type': 'agent_finished',
            'timestampMs': 31,
            'sessionId': 'cc-1',
          }),
        )?.isIdle,
        isTrue,
      );

      expect(
        runtimeSessionStatusFromEvent(
          RuntimeEvent.fromJson({
            'backend': 'pi',
            'type': 'retry_finished',
            'timestampMs': 32,
            'sessionId': 'pi-1',
            'success': true,
          }),
        ),
        isNull,
      );
    });
  });
}
