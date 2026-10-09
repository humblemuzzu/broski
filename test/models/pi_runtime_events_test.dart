import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> piEvent(
  String type, {
  int seq = 1,
  Map<String, dynamic> extra = const {},
}) {
  return <String, dynamic>{
    'type': type,
    'backend': 'pi',
    'timestampMs': 1720000000000 + seq,
    'sessionId': 'pi-session-1',
    'seq': seq,
    'streamId': 'pi-stream-1',
    ...extra,
  };
}

void main() {
  group('Pi runtime event parsing', () {
    test('parses agent lifecycle events for the pi backend', () {
      final started = RuntimeEvent.fromJson(piEvent('agent_started'));
      expect(started, isA<RuntimeAgentStartedEvent>());
      expect(started.type, 'agent_started');
      expect(started.backend, AgentType.pi);

      final finished = RuntimeEvent.fromJson(
        piEvent('agent_finished', extra: {'stopReason': 'end-turn'}),
      );
      expect(finished, isA<RuntimeAgentFinishedEvent>());
      expect(finished.backend, AgentType.pi);
      expect((finished as RuntimeAgentFinishedEvent).stopReason, 'end-turn');
    });

    test('parses Pi text and thinking deltas', () {
      final text = RuntimeEvent.fromJson(
        piEvent('assistant_text_delta', extra: {'delta': 'Hello'}),
      );
      expect(text, isA<RuntimeAssistantTextDeltaEvent>());
      expect((text as RuntimeAssistantTextDeltaEvent).delta, 'Hello');

      final thinking = RuntimeEvent.fromJson(
        piEvent('assistant_thinking_delta', extra: {'delta': 'plan'}),
      );
      expect(thinking, isA<RuntimeAssistantThinkingDeltaEvent>());
      expect((thinking as RuntimeAssistantThinkingDeltaEvent).delta, 'plan');
    });

    test(
      'parses the Pi tool lifecycle with input, partial output, and error',
      () {
        final started =
            RuntimeEvent.fromJson(
                  piEvent(
                    'tool_started',
                    extra: {
                      'toolCallId': 'tool-1',
                      'toolName': 'Bash',
                      'input': {'command': 'ls -la'},
                    },
                  ),
                )
                as RuntimeToolStartedEvent;
        expect(started.toolCallId, 'tool-1');
        expect(started.toolName, 'Bash');
        expect(started.input, {'command': 'ls -la'});

        final updated =
            RuntimeEvent.fromJson(
                  piEvent(
                    'tool_updated',
                    extra: {
                      'toolCallId': 'tool-1',
                      'toolName': 'Bash',
                      'partialOutput': 'partial',
                    },
                  ),
                )
                as RuntimeToolUpdatedEvent;
        expect(updated.partialOutput, 'partial');

        final finished =
            RuntimeEvent.fromJson(
                  piEvent(
                    'tool_finished',
                    extra: {
                      'toolCallId': 'tool-1',
                      'toolName': 'Bash',
                      'output': 'file.txt',
                      'isError': false,
                    },
                  ),
                )
                as RuntimeToolFinishedEvent;
        expect(finished.toolCallId, 'tool-1');
        expect(finished.output, 'file.txt');
        expect(finished.isError, isFalse);
      },
    );

    test('parses Pi compaction lifecycle events', () {
      final started =
          RuntimeEvent.fromJson(
                piEvent('compaction_started', extra: {'reason': 'threshold'}),
              )
              as RuntimeCompactionStartedEvent;
      expect(started.reason, 'threshold');

      final finished =
          RuntimeEvent.fromJson(
                piEvent(
                  'compaction_finished',
                  extra: {
                    'aborted': false,
                    'willRetry': true,
                    'errorMessage': 'boom',
                  },
                ),
              )
              as RuntimeCompactionFinishedEvent;
      expect(finished.aborted, isFalse);
      expect(finished.willRetry, isTrue);
      expect(finished.errorMessage, 'boom');
    });

    test('parses Pi retry lifecycle events', () {
      final started =
          RuntimeEvent.fromJson(
                piEvent(
                  'retry_started',
                  extra: {
                    'attempt': 2,
                    'maxAttempts': 5,
                    'delayMs': 800,
                    'errorMessage': 'rate limited',
                  },
                ),
              )
              as RuntimeRetryStartedEvent;
      expect(started.attempt, 2);
      expect(started.maxAttempts, 5);
      expect(started.delayMs, 800);
      expect(started.errorMessage, 'rate limited');

      final finished =
          RuntimeEvent.fromJson(
                piEvent(
                  'retry_finished',
                  extra: {'success': false, 'attempt': 2, 'finalError': 'nope'},
                ),
              )
              as RuntimeRetryFinishedEvent;
      expect(finished.success, isFalse);
      expect(finished.attempt, 2);
      expect(finished.finalError, 'nope');
    });

    test('parses Pi error events', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent('error', extra: {'message': 'boom', 'code': 'E_PI'}),
              )
              as RuntimeErrorEvent;
      expect(event.message, 'boom');
      expect(event.code, 'E_PI');
    });

    test('keeps the extension-ui-request payload intact', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent(
                  'backend_event',
                  extra: {
                    'kind': 'extension-ui-request',
                    'payload': {
                      'id': 'req-1',
                      'method': 'confirm',
                      'title': 'Allow?',
                    },
                  },
                ),
              )
              as RuntimeBackendEvent;

      expect(event.kind, 'extension-ui-request');
      final payload = event.payload as Map<String, dynamic>;
      expect(payload['id'], 'req-1');
      expect(payload['method'], 'confirm');
      expect(payload['title'], 'Allow?');

      final json = event.toJson();
      expect(json['kind'], 'extension-ui-request');
      expect((json['payload'] as Map<String, dynamic>)['method'], 'confirm');
    });

    test('keeps the external-user-message payload intact', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent(
                  'backend_event',
                  extra: {
                    'kind': 'external-user-message',
                    'payload': {
                      'content': 'typed on mac',
                      'timestamp': 1720000000500,
                    },
                  },
                ),
              )
              as RuntimeBackendEvent;

      expect(event.kind, 'external-user-message');
      final payload = event.payload as Map<String, dynamic>;
      expect(payload['content'], 'typed on mac');
      expect(payload['timestamp'], 1720000000500);
    });

    test('keeps the bash-output payload intact', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent(
                  'backend_event',
                  extra: {
                    'kind': 'bash-output',
                    'payload': {'content': 'chunk'},
                  },
                ),
              )
              as RuntimeBackendEvent;

      expect(event.kind, 'bash-output');
      expect((event.payload as Map<String, dynamic>)['content'], 'chunk');
    });

    test('keeps the queue-update steering and follow-up lists intact', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent(
                  'backend_event',
                  extra: {
                    'kind': 'queue-update',
                    'payload': {
                      'steering': ['steer-1', 'steer-2'],
                      'followUp': ['follow-1'],
                    },
                  },
                ),
              )
              as RuntimeBackendEvent;

      expect(event.kind, 'queue-update');
      final payload = event.payload as Map<String, dynamic>;
      expect(payload['steering'], ['steer-1', 'steer-2']);
      expect(payload['followUp'], ['follow-1']);
    });

    test('preserves the Pi event envelope fields', () {
      final event = RuntimeEvent.fromJson(
        piEvent(
          'assistant_text_delta',
          seq: 17,
          extra: {
            'delta': 'Hi',
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-9',
            'turnId': 'turn-1',
            'cwd': '/tmp/project',
            'replayed': true,
            'backendData': {'sourceType': 'text-delta'},
          },
        ),
      );

      expect(event.seq, 17);
      expect(event.replayed, isTrue);
      expect(event.messageId, 'pi-msg-1');
      expect(event.toolCallId, 'tool-9');
      expect(event.streamId, 'pi-stream-1');
      expect(event.turnId, 'turn-1');
      expect(event.cwd, '/tmp/project');
      expect(event.backendData, {'sourceType': 'text-delta'});

      expect(RuntimeEvent.fromJson(piEvent('agent_started')).replayed, isFalse);
    });

    test('wraps an unwrapped Pi stream type as an unknown backend event', () {
      final event =
          RuntimeEvent.fromJson(
                piEvent('bash-output', extra: {'content': 'raw'}),
              )
              as RuntimeBackendEvent;

      expect(event.kind, 'unknown');
      final payload = event.payload as Map<String, dynamic>;
      expect(payload['type'], 'bash-output');
      expect(payload['content'], 'raw');
      expect(event.backend, AgentType.pi);
    });
  });
}
