import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat/runtime_common_models.dart';
import 'package:broski/providers/chat/runtime_common_reducer.dart';
import 'package:flutter_test/flutter_test.dart';

/// The bridge merges consecutive text deltas of one stream into a single event whose `seq` is the
/// newest one (src/transport/runtime-event-coalescer.ts), so a client sees `1, 9, 10` instead of
/// `1..10`. These tests pin the two app-side assumptions that make that safe: a merged delta is one
/// appended append, and a replay of the same merged event is deduped by its fingerprint.
void main() {
  group('merged runtime delta', () {
    test('appends the concatenated text once even though seq jumps', () {
      RuntimeChatTurnState? turn;

      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'pi',
          'type': 'agent_started',
          'timestampMs': 1,
          'sessionId': 'pi-1',
          'streamId': 'stream-1',
          'seq': 1,
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'pi',
          'type': 'assistant_text_delta',
          'timestampMs': 2,
          'sessionId': 'pi-1',
          'streamId': 'stream-1',
          'seq': 2,
          'delta': 'Hel',
        }),
      );
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'pi',
          'type': 'assistant_text_delta',
          'timestampMs': 9,
          'sessionId': 'pi-1',
          'streamId': 'stream-1',
          'seq': 9,
          'delta': 'lo world',
        }),
      );

      expect(turn.assistantText, 'Hello world');
      expect(turn.parts.length, 1);
    });

    test('a replayed copy of the merged event is deduped', () {
      final merged = RuntimeEvent.fromJson({
        'backend': 'pi',
        'type': 'assistant_text_delta',
        'timestampMs': 9,
        'sessionId': 'pi-1',
        'streamId': 'stream-1',
        'seq': 9,
        'delta': 'lo world',
      });

      var turn = reduceRuntimeChatEvent(null, merged);
      turn = reduceRuntimeChatEvent(turn, merged);
      turn = reduceRuntimeChatEvent(
        turn,
        RuntimeEvent.fromJson({
          'backend': 'pi',
          'type': 'assistant_text_delta',
          'timestampMs': 9,
          'sessionId': 'pi-1',
          'streamId': 'stream-1',
          'seq': 9,
          'delta': 'lo world',
          'replayed': true,
        }),
      );

      expect(turn.assistantText, 'lo world');
    });

    test('cross-session activity arrives without a seq and still reduces', () {
      // The bridge strips `seq` from activity events for sessions the phone is not viewing, so the
      // ingest's lost-event detector (seq > last + 1) cannot fire and move the view.
      final turn = reduceRuntimeChatEvent(
        null,
        RuntimeEvent.fromJson({
          'backend': 'claude-code',
          'type': 'agent_finished',
          'timestampMs': 42,
          'sessionId': 'cc-other',
        }),
      );

      expect(turn.lastEventSeq, isNull);
      expect(turn.isStreaming, isFalse);
    });
  });
}
