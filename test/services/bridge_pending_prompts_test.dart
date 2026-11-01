import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/services/bridge/bridge_pending_prompts.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _sessionsActive(Map<String, dynamic> pending) => {
  'claudeCode': const [],
  'pendingPermissions': pending,
};

void main() {
  test('a pending Claude Code tool use becomes an approvable prompt', () {
    final payloads = pendingPromptPayloads(
      _sessionsActive({
        'claudeCode': [
          {'sessionId': 'cc-1', 'toolUseId': 'toolu-1'},
        ],
      }),
      nowMs: 1700000000000,
    );

    expect(payloads, hasLength(1));
    final event = RuntimeEvent.fromJson(payloads.single);
    expect(event, isA<RuntimePermissionRequestedEvent>());
    expect(event.backend, AgentType.claudeCode);
    expect(event.sessionId, 'cc-1');
    expect(
      (event as RuntimePermissionRequestedEvent).request.requestId,
      'toolu-1',
    );
  });

  test('a pending elicitation is restored with the prompt the bridge kept', () {
    final payloads = pendingPromptPayloads(
      _sessionsActive({
        'claudeCodeElicitations': [
          {
            'sessionId': 'cc-2',
            'requestId': 'elic-1',
            'mcpServerName': 'linear',
            'message': 'Authorise Linear',
            'url': 'https://linear.example/authorize',
            'mode': 'url',
          },
        ],
      }),
      nowMs: 1700000000000,
    );

    final event = RuntimeEvent.fromJson(payloads.single);
    final backend = event as RuntimeBackendEvent;
    expect(backend.kind, 'elicitation-request');
    expect(backend.payload, {
      'requestId': 'elic-1',
      'mcpServerName': 'linear',
      'message': 'Authorise Linear',
      'url': 'https://linear.example/authorize',
      'mode': 'url',
    });
  });

  test('everything pending comes back together', () {
    final payloads = pendingPromptPayloads(
      _sessionsActive({
        'claudeCode': [
          {'sessionId': 'cc-1', 'toolUseId': 'toolu-1'},
          {'sessionId': 'cc-2', 'toolUseId': 'toolu-2'},
        ],
        'claudeCodeElicitations': [
          {'sessionId': 'cc-3', 'requestId': 'elic-1'},
        ],
      }),
      nowMs: 1700000000000,
    );

    expect(payloads, hasLength(3));
  });

  test('an entry without a request id is skipped rather than guessed', () {
    expect(
      pendingPromptPayloads(
        _sessionsActive({
          'claudeCode': [
            {'sessionId': 'cc-1'},
          ],
          'claudeCodeElicitations': [
            {'sessionId': 'cc-2'},
          ],
        }),
      ),
      isEmpty,
    );
  });

  test('a reply without pending permissions restores nothing', () {
    expect(pendingPromptPayloads(const {}), isEmpty);
    expect(pendingPromptPayloads(null), isEmpty);
    expect(
      pendingPromptPayloads({
        'pendingPermissions': {'claudeCode': 'not a list'},
      }),
      isEmpty,
    );
  });
}
