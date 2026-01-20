import 'package:flutter_test/flutter_test.dart';

import 'package:broski/utils/terminal_output_throttler.dart';

void main() {
  testWidgets('batches output and flushes at cadence', (tester) async {
    final flushed = <String>[];
    final throttler = TerminalOutputThrottler(
      onFlush: flushed.add,
      batchWindow: const Duration(milliseconds: 16),
    );

    throttler.add('a');
    throttler.add('b');
    throttler.add('c');
    expect(flushed, isEmpty);

    await tester.pump(const Duration(milliseconds: 16));
    expect(flushed, ['abc']);

    throttler.dispose();
  });

  testWidgets('flushes immediately when exceeding max buffer', (tester) async {
    final flushed = <String>[];
    final throttler = TerminalOutputThrottler(
      onFlush: flushed.add,
      batchWindow: const Duration(milliseconds: 16),
      maxBufferedChars: 4,
    );

    throttler.add('abcd');
    expect(flushed, ['abcd']);

    throttler.add('e');
    await tester.pump(const Duration(milliseconds: 16));
    expect(flushed, ['abcd', 'e']);

    throttler.dispose();
  });
}
