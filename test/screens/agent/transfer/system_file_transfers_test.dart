import 'dart:io';
import 'dart:typed_data';

import 'package:broski/screens/agent/panels/transfer/system_file_transfers.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late Directory root;

  setUp(() async => root = await Directory.systemTemp.createTemp('downloads-'));
  tearDown(() async => root.delete(recursive: true));

  Directory downloads() => Directory('${root.path}/broski-downloads');

  test('a new download leaves the one before it in place, which a share '
      'sheet may still be reading', () async {
    final files = SystemFileTransfers(temporary: () async => root);
    final first = await files.startDownload('a.html');
    await first.add(Uint8List.fromList([1, 2, 3]));
    await files.startDownload('b.html');
    expect(await downloads().list().length, 2);
  });

  test('a download a crash left behind goes once it is a day old', () async {
    final today = SystemFileTransfers(temporary: () async => root);
    await today.startDownload('left.html');
    final tomorrow = SystemFileTransfers(
      temporary: () async => root,
      now: () => DateTime.now().add(const Duration(days: 2)),
    );
    await tomorrow.startDownload('new.html');
    expect(await downloads().list().length, 1);
  });

  test('a discarded download is gone with its folder', () async {
    final files = SystemFileTransfers(temporary: () async => root);
    final file = await files.startDownload('a.html');
    await file.discard();
    expect(await downloads().list().length, 0);
  });
}
