import 'package:broski/utils/input_batcher.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('sends first char immediately', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add);

    batcher.add('g');
    expect(flushed, ['g']); // First char is always immediate

    batcher.dispose();
  });

  test('batches paste-like input (multi-char)', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add, pasteThreshold: 3);

    // Multi-char input (>= pasteThreshold) is batched
    batcher.add('hello');
    expect(flushed, isEmpty);

    // Force flush
    batcher.flush();
    expect(flushed, ['hello']);

    batcher.dispose();
  });

  test('flushes immediately for Enter', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add);

    // Enter should flush immediately
    batcher.add('\r');
    expect(flushed, ['\r']);

    batcher.dispose();
  });

  test('flushes immediately for Tab', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add);

    batcher.add('\t');
    expect(flushed, ['\t']);

    batcher.dispose();
  });

  test('flushes immediately for Ctrl+C', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add);

    batcher.add('\x03'); // Ctrl+C
    expect(flushed, ['\x03']);

    batcher.dispose();
  });

  test('flushes pending buffer before immediate chars', () {
    final flushed = <String>[];
    final batcher = SmartInputBatcher(onFlush: flushed.add, pasteThreshold: 3);

    // Add paste-like input (buffered)
    batcher.add('hello');
    expect(flushed, isEmpty);

    // Add enter (immediate) - should flush buffer first
    batcher.add('\r');
    expect(flushed, ['hello', '\r']);

    batcher.dispose();
  });

  test('hasPendingData reflects buffer state', () {
    final batcher = SmartInputBatcher(onFlush: (_) {}, pasteThreshold: 3);

    expect(batcher.hasPendingData, false);

    batcher.add('hello'); // Buffered
    expect(batcher.hasPendingData, true);

    batcher.flush();
    expect(batcher.hasPendingData, false);

    batcher.dispose();
  });
}
