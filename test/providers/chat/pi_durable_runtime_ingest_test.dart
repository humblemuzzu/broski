import 'package:broski/models/agent_type.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/pi_durable/pi_durable_session.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:flutter_test/flutter_test.dart';

/// A recorded `pi-durable` stream, in the order the bridge emits it: the attach
/// snapshot first, then the turn, then the terminal event.
const sessionId = 'pd-session-1';

RuntimeEvent pd(
  String type, {
  int seq = 1,
  Map<String, dynamic> extra = const {},
}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
    'type': type,
    'backend': 'pi-durable',
    'timestampMs': 2000 + seq,
    'sessionId': sessionId,
    'cwd': '/Users/dev/app',
    'seq': seq,
    'streamId': 'pd-stream-1',
    ...extra,
  });
}

RuntimeChatTurnState? reduceAll(List<RuntimeEvent> events) {
  RuntimeChatTurnState? turn;
  for (final event in events) {
    turn = reduceRuntimeChatEvent(turn, event);
  }
  return turn;
}

void main() {
  group('Pi Durable runtime ingest', () {
    test('parses the attach snapshot as a session_state_changed event', () {
      final event = pd(
        'session_state_changed',
        extra: {
          'state': {
            'backend': 'pi-durable',
            'sessionId': sessionId,
            'isStreaming': false,
            'capabilities': {
              'canStreamText': true,
              'canRequestPermissions': true,
              'canRequestUserInput': false,
            },
          },
        },
      );
      expect(event, isA<RuntimeSessionStateChangedEvent>());
      final state = (event as RuntimeSessionStateChangedEvent).state;
      expect(state.sessionId, sessionId);
      expect(state.isStreaming, isFalse);
      expect(state.capabilities.canRequestPermissions, isTrue);
      expect(state.capabilities.canRequestUserInput, isFalse);
    });

    test('reduces a whole turn into one assistant message', () {
      final turn = reduceAll([
        pd('agent_started'),
        pd(
          'assistant_text_delta',
          seq: 2,
          extra: {'messageId': 'pd-msg-1', 'delta': 'Hello'},
        ),
        pd(
          'assistant_thinking_delta',
          seq: 3,
          extra: {'messageId': 'pd-msg-1', 'delta': 'plan'},
        ),
        pd(
          'assistant_text_delta',
          seq: 4,
          extra: {'messageId': 'pd-msg-1', 'delta': ' world'},
        ),
        pd(
          'tool_started',
          seq: 5,
          extra: {
            'messageId': 'pd-msg-1',
            'toolCallId': 'call-1',
            'toolName': 'bash',
            'input': {'command': 'echo hi'},
          },
        ),
        pd(
          'tool_updated',
          seq: 6,
          extra: {
            'messageId': 'pd-msg-1',
            'toolCallId': 'call-1',
            'toolName': 'bash',
            'partialOutput': 'hi',
          },
        ),
        pd(
          'tool_finished',
          seq: 7,
          extra: {
            'messageId': 'pd-msg-1',
            'toolCallId': 'call-1',
            'toolName': 'bash',
            'output': 'hi\n',
            'isError': false,
          },
        ),
        pd('agent_finished', seq: 8),
      ]);

      expect(turn!.backend, AgentType.piDurable);
      expect(turn.isStreaming, isFalse);
      expect(turn.assistantText, 'Hello world');
      expect(turn.thinkingText, 'plan');
      expect(turn.tools['call-1']!.status, 'completed');
      expect(turn.tools['call-1']!.output, 'hi\n');

      final message = buildRuntimeChatMessage(
        turn,
        createdAt: DateTime(2026),
        diffs: const [],
      );
      expect(message, isNotNull);
      expect(message!.text, 'Hello world');
      expect(message.reasoningText, 'plan');
      expect(message.toolCalls, hasLength(1));
      expect(message.parts.whereType<TextPart>(), hasLength(1));
      expect(message.parts.whereType<ToolPart>(), hasLength(1));
      expect(message.isStreaming, isFalse);
    });

    test(
      'carries the permission prompt through with the bridge request id',
      () {
        final event = pd(
          'permission_requested',
          seq: 3,
          extra: {
            'request': {
              'requestId': '$sessionId:call-1',
              'kind': 'bash',
              'title': 'Run: echo hi',
              'options': ['allow', 'deny'],
              'metadata': {
                'tool': 'bash',
                'input': {'command': 'echo hi'},
                'sessionId': sessionId,
              },
            },
          },
        );
        expect(event, isA<RuntimePermissionRequestedEvent>());
        final request = (event as RuntimePermissionRequestedEvent).request;
        expect(request.requestId, '$sessionId:call-1');
        expect(request.kind, 'bash');
        expect(request.title, 'Run: echo hi');
        expect(request.options, ['allow', 'deny']);
        expect(request.metadata!['sessionId'], sessionId);
        expect(request.metadata!['input'], {'command': 'echo hi'});
      },
    );

    test('keeps a replayed permission prompt flagged as replayed', () {
      final event = pd(
        'permission_requested',
        extra: {
          'replayed': true,
          'request': {'requestId': '$sessionId:call-9', 'kind': 'write'},
        },
      );
      expect(event.replayed, isTrue);
    });

    test('turns a resumed backend_event into the banner text', () {
      final event = pd(
        'backend_event',
        seq: 1,
        extra: {
          'kind': 'resumed',
          'payload': {'tasks': 2, 'submissions': 1},
        },
      );
      expect(event, isA<RuntimeBackendEvent>());
      final backendEvent = event as RuntimeBackendEvent;
      expect(backendEvent.kind, 'resumed');
      expect(
        piDurableResumeNoticeText(backendEvent.backend, backendEvent.payload),
        'Resumed interrupted work: 2 tool calls and 1 queued prompt',
      );
    });

    test('a resumed event with nothing resumed produces no banner', () {
      expect(
        piDurableResumeNoticeText(AgentType.piDurable, const {
          'tasks': 0,
          'submissions': 0,
        }),
        isNull,
      );
      expect(piDurableResumeNoticeText(AgentType.pi, null), isNull);
      expect(
        piDurableResumeNoticeText(AgentType.piDurable, const {'tasks': 1}),
        'Resumed interrupted work: 1 tool call',
      );
    });
  });
}
