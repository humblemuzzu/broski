import 'dart:async';
import 'dart:typed_data';

import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:flutter/painting.dart' show Rect;

/// The phone's files, in memory: what is downloaded is kept for the test to
/// read, what is shared is noted, and the file "chosen" is the one given.
final class MemoryFileTransfers implements FileTransfers {
  MemoryFileTransfers({this.pick});

  /// What the person chooses; null is choosing nothing.
  PickedFile? pick;

  final List<MemoryDownload> downloads = [];

  @override
  Future<DownloadedFile> startDownload(String name) async {
    final download = MemoryDownload(name);
    downloads.add(download);
    return download;
  }

  @override
  Future<PickedFile?> pickFile() async => pick;
}

final class MemoryDownload implements DownloadedFile {
  MemoryDownload(this.name);

  final String name;
  final BytesBuilder _bytes = BytesBuilder(copy: false);
  final List<String> sharedAs = [];
  var discarded = false;

  Uint8List get bytes => _bytes.toBytes();

  @override
  Future<void> add(Uint8List bytes) async => _bytes.add(bytes);

  @override
  Future<void> share({required String mimeType, Rect? origin}) async =>
      sharedAs.add(mimeType);

  @override
  Future<void> discard() async => discarded = true;
}

final class MemoryPickedFile implements PickedFile {
  MemoryPickedFile(this.name, this.contents, {this.chunk = 100000});

  @override
  final String name;
  final Uint8List contents;
  final int chunk;

  @override
  int get size => contents.length;

  @override
  Stream<List<int>> open() async* {
    for (var from = 0; from < contents.length; from += chunk) {
      yield contents.sublist(from, (from + chunk).clamp(0, contents.length));
    }
  }
}
