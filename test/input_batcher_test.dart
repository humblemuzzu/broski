import 'package:flutter_test/flutter_test.dart';

import 'package:broski/utils/input_batcher.dart';

void main() {
  testWidgets('batches input and flushes on timer', (tester) async {
    final flushed = <String>[];
    final batcher = InputBatcher(
      onFlush: flushed.add,
      batchWindow: const Duration(milliseconds: 16),
    );

    batcher.add('g');
    batcher.add('i');
    batcher.add('t');
    expect(flushed, isEmpty);

    await tester.pump(const Duration(milliseconds: 16));
    expect(flushed, ['git']);

    batcher.dispose();
  });

  testWidgets('flushes immediately for enter/tab/ctrl', (tester) async {
    final flushed = <String>[];
    final batcher = InputBatcher(onFlush: flushed.add);

    batcher.add('echo ');
    batcher.add('"hi"');
    expect(flushed, isEmpty);

    batcher.add('\r');
    expect(flushed, ['echo "hi"\r']);

    await tester.pump(const Duration(milliseconds: 50));
    expect(flushed, ['echo "hi"\r']);

    batcher.dispose();
  });
}
