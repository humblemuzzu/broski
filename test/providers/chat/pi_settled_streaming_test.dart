import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
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
    ...extra,
  });
}

/// The bridge ends a Pi run with `agent-end` and follows it with a state snapshot at `agent-settled`;
/// every state snapshot stays authoritative for whether the session is streaming.
void main() {
  group('Pi turn settling', () {
    test('an intermediate agent-end is overridden by the run snapshot', () {
      var turn = reduceRuntimeChatEvent(null, pi('agent_started'));
      turn = reduceRuntimeChatEvent(
        turn,
        pi(
          'agent_finished',
          seq: 2,
          extra: {
            'backendData': {'sourceType': 'agent-end', 'messages': []},
          },
        ),
      );
      expect(turn.isStreaming, isFalse);

      turn = reduceRuntimeChatState(
        turn,
        const RuntimeState(
          backend: AgentType.pi,
          sessionId: 'pi-1',
          isStreaming: true,
        ),
      );

      expect(turn.isStreaming, isTrue);
    });

    test('the settled snapshot ends the run', () {
      var turn = reduceRuntimeChatEvent(null, pi('agent_started'));
      turn = reduceRuntimeChatEvent(
        turn,
        pi(
          'agent_finished',
          seq: 2,
          extra: {
            'backendData': {'sourceType': 'agent-settled', 'aborted': false},
          },
        ),
      );
      expect(turn.isStreaming, isFalse);

      turn = reduceRuntimeChatState(
        turn,
        const RuntimeState(
          backend: AgentType.pi,
          sessionId: 'pi-1',
          isStreaming: false,
        ),
      );

      expect(turn.isStreaming, isFalse);
    });
  });
}
