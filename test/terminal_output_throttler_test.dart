import 'package:flutter_test/flutter_test.dart';

import 'package:broski/utils/terminal_output_throttler.dart';

void main() {
  test('writes small output immediately', () {
    final flushed = <String>[];
    final throttler = SmartOutputThrottler(
      onFlush: flushed.add,
      instantThreshold: 500,
    );

    throttler.add('hello');
    expect(flushed, ['hello']);

    throttler.add(' world');
    expect(flushed, ['hello', ' world']);

    throttler.dispose();
  });

  test('buffers large output chunks', () {
    final flushed = <String>[];
    final throttler = SmartOutputThrottler(
      onFlush: flushed.add,
      instantThreshold: 10,
    );

    // Large output = buffered
    final largeOutput = 'x' * 100;
    throttler.add(largeOutput);
    expect(flushed, isEmpty);

    // Manual flush
    throttler.flush();
    expect(flushed, [largeOutput]);

    throttler.dispose();
  });

  test('flushes immediately when exceeding max buffer', () {
    final flushed = <String>[];
    final throttler = SmartOutputThrottler(
      onFlush: flushed.add,
      instantThreshold: 10,
      maxBufferSize: 50,
    );

    // Huge output exceeds buffer = immediate flush (safety valve)
    final hugeOutput = 'x' * 60;
    throttler.add(hugeOutput);
    expect(flushed, [hugeOutput]);

    throttler.dispose();
  });

  test('hasPendingData reflects buffer state', () {
    final throttler = SmartOutputThrottler(
      onFlush: (_) {},
      instantThreshold: 10,
    );

    expect(throttler.hasPendingData, false);

    throttler.add('x' * 50); // Large = buffered
    expect(throttler.hasPendingData, true);

    throttler.flush();
    expect(throttler.hasPendingData, false);

    throttler.dispose();
  });

  test('detects flood mode on high throughput', () {
    final throttler = SmartOutputThrottler(
      onFlush: (_) {},
      instantThreshold: 500,
      floodThresholdBytesPerSec: 100,
    );

    expect(throttler.isInFloodMode, false);

    // Simulate flood
    for (var i = 0; i < 20; i++) {
      throttler.add('chunk$i with more data\n');
    }

    expect(throttler.isInFloodMode, true);

    throttler.dispose();
  });
}
