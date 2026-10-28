import 'package:broski/models/message.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeEvent pi(
  String type, {
  int seq = 1,
  Map<String, dynamic> extra = const {},
}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
    'type': type,
    'backend': 'pi',
    'timestampMs': 1000 + seq,
    'sessionId': 'pi-1',
    'seq': seq,
    'streamId': 'pi-stream-1',
    ...extra,
  });
}

RuntimeChatTurnState? reduceAllPi(List<RuntimeEvent> events) {
  RuntimeChatTurnState? turn;
  for (final event in events) {
    turn = reduceRuntimeChatEvent(turn, event);
  }
  return turn;
}

void main() {
  group('Pi runtime chat ingest', () {
    test('accumulates Pi text and thinking deltas into one assistant turn', () {
      final turn = reduceAllPi([
        pi('agent_started'),
        pi(
          'assistant_text_delta',
          seq: 2,
          extra: {'messageId': 'pi-msg-1', 'delta': 'Hello'},
        ),
        pi(
          'assistant_thinking_delta',
          seq: 3,
          extra: {'messageId': 'pi-msg-1', 'delta': 'plan'},
        ),
        pi(
          'assistant_text_delta',
          seq: 4,
          extra: {'messageId': 'pi-msg-1', 'delta': ' world'},
        ),
      ]);

      expect(turn!.assistantText, 'Hello world');
      expect(turn.thinkingText, 'plan');
      final textParts = turn.parts.whereType<TextPart>().toList();
      expect(textParts, hasLength(1));
      expect(textParts.single.text, 'Hello world');
      expect(turn.parts.whereType<ToolPart>(), isEmpty);
    });

    test('produces one Pi tool card carrying the final output and status', () {
      final turn = reduceAllPi([
        pi('agent_started'),
        pi(
          'tool_started',
          seq: 2,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
            'input': {'command': 'ls -la'},
          },
        ),
        pi(
          'tool_updated',
          seq: 3,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
            'partialOutput': 'partial',
          },
        ),
        pi(
          'tool_finished',
          seq: 4,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
            'output': 'file.txt',
            'isError': false,
          },
        ),
      ]);

      expect(turn!.tools, hasLength(1));
      final tool = turn.tools['tool-1']!;
      expect(tool.name, 'Bash');
      expect(tool.input, {'command': 'ls -la'});
      expect(tool.output, 'file.txt');
      expect(tool.status, 'completed');
      expect(turn.parts.whereType<ToolPart>(), hasLength(1));
    });

    test('marks a Pi tool as failed when the finish event is an error', () {
      final turn = reduceAllPi([
        pi(
          'tool_started',
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
          },
        ),
        pi(
          'tool_finished',
          seq: 2,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
            'output': 'exit 1',
            'isError': true,
          },
        ),
      ]);

      expect(turn!.tools.values.single.status, 'failed');
      expect(turn.tools.values.single.output, 'exit 1');
    });

    test('builds one Pi assistant message in order and stops on finish', () {
      final turn = reduceAllPi([
        pi('agent_started'),
        pi(
          'assistant_text_delta',
          seq: 2,
          extra: {'messageId': 'pi-msg-1', 'delta': 'Hello'},
        ),
        pi(
          'assistant_thinking_delta',
          seq: 3,
          extra: {'messageId': 'pi-msg-1', 'delta': 'plan'},
        ),
        pi(
          'assistant_text_delta',
          seq: 4,
          extra: {'messageId': 'pi-msg-1', 'delta': ' world'},
        ),
        pi(
          'tool_started',
          seq: 5,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
          },
        ),
        pi(
          'tool_finished',
          seq: 6,
          extra: {
            'messageId': 'pi-msg-1',
            'toolCallId': 'tool-1',
            'toolName': 'Bash',
            'output': 'file.txt',
          },
        ),
        pi('agent_finished', seq: 7),
      ]);

      expect(turn!.isStreaming, isFalse);

      final message = buildRuntimeChatMessage(
        turn,
        createdAt: DateTime(2026),
        diffs: const [],
      );

      expect(message, isNotNull);
      expect(message!.text, 'Hello world');
      expect(message.reasoningText, 'plan');
      expect(message.toolCalls, hasLength(1));
      expect(message.toolCalls.single.status, 'completed');
      expect(message.parts.map((part) => part.runtimeType.toString()), [
        'TextPart',
        'ToolPart',
      ]);
      expect(message.isStreaming, isFalse);
    });

    test(
      'drops a replayed Pi delta with the same seq but keeps new deltas',
      () {
        const json = <String, dynamic>{
          'type': 'assistant_text_delta',
          'backend': 'pi',
          'timestampMs': 1009,
          'sessionId': 'pi-1',
          'seq': 9,
          'messageId': 'pi-msg-1',
          'delta': 'dup',
        };

        var turn = reduceRuntimeChatEvent(null, RuntimeEvent.fromJson(json));
        turn = reduceRuntimeChatEvent(
          turn,
          RuntimeEvent.fromJson({...json, 'replayed': true}),
        );

        expect(turn.assistantText, 'dup');

        turn = reduceRuntimeChatEvent(
          turn,
          RuntimeEvent.fromJson({...json, 'seq': 10, 'delta': ' dup2'}),
        );

        expect(turn.assistantText, 'dup dup2');
      },
    );
  });
}
