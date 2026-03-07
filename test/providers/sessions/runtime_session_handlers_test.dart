import 'package:flutter_test/flutter_test.dart';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/sessions/runtime_session_activity_handler.dart';
import 'package:broski/providers/sessions/runtime_session_snapshot_handler.dart';

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
            backend: AgentType.opencode,
            sessionId: 'oc-1',
            isStreaming: true,
          ),
        ).isBusy,
        isTrue,
      );

      expect(
        runtimeSessionStatusFromState(
          const RuntimeState(backend: AgentType.opencode, sessionId: 'oc-1'),
        ).isIdle,
        isTrue,
      );
    });

    test('maps active summaries to busy and inactive summaries to idle', () {
      final statuses = runtimeSessionStatusesFromSummaries([
        const RuntimeSessionSummary(
          backend: AgentType.codex,
          id: 'cx-1',
          title: 'Session 1',
          cwd: '/tmp/cx-1',
          createdAtMs: 1,
          updatedAtMs: 2,
          isActive: true,
        ),
        const RuntimeSessionSummary(
          backend: AgentType.codex,
          id: 'cx-2',
          title: 'Session 2',
          cwd: '/tmp/cx-2',
          createdAtMs: 3,
          updatedAtMs: 4,
          isActive: false,
        ),
      ]);

      expect(statuses['cx-1']?.isBusy, isTrue);
      expect(statuses['cx-2']?.isIdle, isTrue);
    });

    test(
      'derives summary status from backend status payloads only when honest',
      () {
        final statuses = runtimeSessionStatusesFromSummaries([
          const RuntimeSessionSummary(
            backend: AgentType.codex,
            id: 'cx-running',
            title: 'Running',
            cwd: '/tmp/cx-running',
            createdAtMs: 1,
            updatedAtMs: 2,
            backendData: {
              'status': {'type': 'active'},
            },
          ),
          const RuntimeSessionSummary(
            backend: AgentType.claudeCode,
            id: 'cc-unknown',
            title: 'Unknown',
            cwd: '/tmp/cc-unknown',
            createdAtMs: 3,
            updatedAtMs: 4,
          ),
        ]);

        expect(statuses['cx-running']?.isBusy, isTrue);
        expect(statuses.containsKey('cc-unknown'), isFalse);
      },
    );
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
          'backend': 'codex',
          'type': 'retry_started',
          'timestampMs': 20,
          'sessionId': 'cx-1',
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
          'backend': 'opencode',
          'type': 'session_state_changed',
          'timestampMs': 30,
          'sessionId': 'oc-1',
          'state': {
            'backend': 'opencode',
            'sessionId': 'oc-1',
            'isStreaming': true,
          },
        }),
      );

      expect(stateStatus?.isBusy, isTrue);
      expect(
        runtimeSessionStatusFromEvent(
          RuntimeEvent.fromJson({
            'backend': 'opencode',
            'type': 'agent_finished',
            'timestampMs': 31,
            'sessionId': 'oc-1',
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
