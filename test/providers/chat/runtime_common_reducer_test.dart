import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('runtime common reducer', () {
    test('preserves common text, tool, and thinking flow ordering', () {
      RuntimeChatTurnState? turn;

      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'agent_started',
          'timestampMs': 1,
          'sessionId': 'cc-1',
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'assistant_text_delta',
          'timestampMs': 2,
          'sessionId': 'cc-1',
          'messageId': 'msg-1',
          'delta': 'Hello',
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'tool_started',
          'timestampMs': 3,
          'sessionId': 'cc-1',
          'messageId': 'msg-1',
          'toolCallId': 'tool-1',
          'toolName': 'Bash',
          'input': {'command': 'ls'},
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'assistant_text_delta',
          'timestampMs': 4,
          'sessionId': 'cc-1',
          'messageId': 'msg-1',
          'delta': ' world',
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'assistant_thinking_delta',
          'timestampMs': 5,
          'sessionId': 'cc-1',
          'messageId': 'msg-1',
          'delta': 'plan',
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'tool_finished',
          'timestampMs': 6,
          'sessionId': 'cc-1',
          'messageId': 'msg-1',
          'toolCallId': 'tool-1',
          'toolName': 'Bash',
          'output': 'file.txt',
        }),
      );
      turn = reduceRuntimeChatState(
        turn,
        const RuntimeState(
          backend: AgentType.claudeCode,
          sessionId: 'cc-1',
          isStreaming: false,
        ),
      );

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
      expect(message.parts.length, 3);
      expect(message.parts[0].runtimeType.toString(), 'TextPart');
      expect(message.parts[1].runtimeType.toString(), 'ToolPart');
      expect(message.parts[2].runtimeType.toString(), 'TextPart');
      expect(message.isStreaming, isFalse);
    });

    test('dedupes repeated runtime events by fingerprint', () {
      final event = RuntimeEvent.fromJson({
        'backend': 'opencode',
        'type': 'assistant_text_delta',
        'timestampMs': 10,
        'sessionId': 'oc-1',
        'messageId': 'msg-1',
        'delta': 'dup',
      });

      var turn = reduceRuntimeChatEvent(null, event);
      turn = reduceRuntimeChatEvent(turn, event);

      expect(turn.assistantText, 'dup');
    });
  });
}
