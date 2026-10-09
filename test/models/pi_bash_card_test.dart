import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeBackendEvent bashOutput(String content, {int seq = 1}) {
  return RuntimeEvent.fromJson(<String, dynamic>{
        'type': 'backend_event',
        'backend': 'pi',
        'timestampMs': 1000 + seq,
        'sessionId': 'pi-1',
        'seq': seq,
        'kind': 'bash-output',
        'payload': {'content': content},
      })
      as RuntimeBackendEvent;
}

void main() {
  group('Pi bash card reduction', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer();
      addTearDown(container.dispose);
    });

    test('running card shows the live streamed buffer', () {
      final metadata = piBashRunningMetadata(
        command: 'make test',
        excludeFromContext: false,
      );

      var card = PiBashCardState.fromMetadata(metadata);
      expect(card.isRunning, isTrue);
      expect(card.command, 'make test');
      expect(card.hasOutput, isFalse);

      container.read(piLiveBashProvider.notifier)
        ..appendChunk(bashOutput('compiling '))
        ..appendChunk(bashOutput('ok', seq: 2));
      final live = container.read(piLiveBashProvider)['pi-1'] ?? '';

      card = PiBashCardState.fromMetadata(metadata, liveOutput: live);
      expect(card.output, 'compiling ok');
      expect(card.isRunning, isTrue);
      expect(card.exitCode, isNull);
    });

    test('finished card prefers the result output over any live buffer', () {
      final metadata = piBashFinishedMetadata(
        command: 'make test',
        excludeFromContext: false,
        output: 'all tests passed',
        exitCode: 0,
      );

      final card = PiBashCardState.fromMetadata(
        metadata,
        liveOutput: 'stale partial chunk',
      );

      expect(card.isRunning, isFalse);
      expect(card.output, 'all tests passed');
      expect(card.exitCode, 0);
      expect(card.isSuccess, isTrue);
    });

    test('finished card surfaces truncation and non-zero exit', () {
      final metadata = piBashFinishedMetadata(
        command: 'cat big.log',
        excludeFromContext: true,
        output: 'partial…',
        exitCode: 2,
        truncated: true,
      );

      final card = PiBashCardState.fromMetadata(metadata);

      expect(card.truncated, isTrue);
      expect(card.exitCode, 2);
      expect(card.excludeFromContext, isTrue);
      expect(card.isSuccess, isFalse);
    });

    test('failed card reports the error and is not a success', () {
      final metadata = piBashFinishedMetadata(
        command: 'sleep 100',
        excludeFromContext: false,
        output: '',
        error: 'timed out',
      );

      final card = PiBashCardState.fromMetadata(metadata);

      expect(card.error, 'timed out');
      expect(card.isRunning, isFalse);
      expect(card.isSuccess, isFalse);
    });

    test('clearSession drops only the named session buffer', () {
      final notifier = container.read(piLiveBashProvider.notifier);
      notifier.appendChunk(bashOutput('a'));

      notifier.clearSession('pi-1');

      expect(container.read(piLiveBashProvider), isEmpty);
    });

    test('transcript entry maps to a finished card and the marker', () {
      final metadata = piBashTranscriptMetadata({
        'role': 'bashExecution',
        'command': 'pwd',
        'output': '/tmp',
        'exitCode': 0,
        'cancelled': false,
        'truncated': false,
        'excludeFromContext': false,
      });

      expect(isPiBashCard(metadata), isTrue);

      final card = PiBashCardState.fromMetadata(metadata);
      expect(card.command, 'pwd');
      expect(card.output, '/tmp');
      expect(card.isRunning, isFalse);
      expect(card.isSuccess, isTrue);
    });
  });
}
