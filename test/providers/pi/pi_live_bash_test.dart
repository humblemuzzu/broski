import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeBackendEvent bashOutput(
  String content, {
  String? sessionId = 'pi-1',
  int seq = 1,
}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
        'type': 'backend_event',
        'backend': 'pi',
        'timestampMs': 1000 + seq,
        if (sessionId != null) 'sessionId': sessionId,
        'seq': seq,
        'kind': 'bash-output',
        'payload': {'content': content},
      })
      as RuntimeBackendEvent;
}

void main() {
  late ProviderContainer container;

  setUp(() {
    container = ProviderContainer();
    addTearDown(container.dispose);
  });

  PiLiveBashNotifier notifier() => container.read(piLiveBashProvider.notifier);

  Map<String, String> chunks() => container.read(piLiveBashProvider);

  group('Pi live bash output', () {
    test('accumulates streamed chunks in arrival order', () {
      notifier().appendChunk(bashOutput('compiling '));
      notifier().appendChunk(bashOutput('3 files', seq: 2));

      expect(chunks()['pi-1'], 'compiling 3 files');

      notifier().appendChunk(bashOutput('\ndone', seq: 3));
      expect(chunks()['pi-1'], 'compiling 3 files\ndone');
    });

    test('ignores empty chunks and events without a session id', () {
      notifier().appendChunk(bashOutput(''));
      notifier().appendChunk(bashOutput('orphan', sessionId: null, seq: 2));

      expect(chunks(), isEmpty);
    });

    test('keeps only the tail once a session exceeds the cap', () {
      final oversized = 'x' * (PiLiveBashNotifier.maxCharsPerSession + 10);

      notifier().appendChunk(bashOutput(oversized));
      notifier().appendChunk(bashOutput('END', seq: 2));

      final output = chunks()['pi-1']!;
      expect(output.length, PiLiveBashNotifier.maxCharsPerSession);
      expect(output.endsWith('END'), isTrue);
    });
  });
}
