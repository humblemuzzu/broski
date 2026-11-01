import 'dart:io';
import 'dart:typed_data';

import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:file_picker/file_picker.dart' show FilePicker, FileType;
import 'package:flutter/painting.dart' show Rect;
import 'package:path_provider/path_provider.dart' show getTemporaryDirectory;
import 'package:share_plus/share_plus.dart' show Share, XFile;

/// The phone's own files: a temporary folder for downloads, the system's file
/// chooser and its share sheet. Each download has a folder of its own, removed
/// when its sheet closes; one a crash left behind goes once it is [staleAfter]
/// old, never one a share sheet may still be reading.
final class SystemFileTransfers implements FileTransfers {
  const SystemFileTransfers({
    this.temporary = getTemporaryDirectory,
    this.now = DateTime.now,
  });

  static const staleAfter = Duration(days: 1);

  final Future<Directory> Function() temporary;
  final DateTime Function() now;

  @override
  Future<DownloadedFile> startDownload(String name) async {
    final root = await temporary();
    final downloads = await Directory(
      '${root.path}/broski-downloads',
    ).create(recursive: true);
    await _removeStale(downloads);
    final own = await downloads.createTemp();
    final file = File('${own.path}/${_fileName(name)}');
    return _Downloaded(own, file, file.openWrite());
  }

  Future<void> _removeStale(Directory downloads) async {
    final before = now().subtract(staleAfter);
    await for (final left in downloads.list()) {
      try {
        if ((await left.stat()).modified.isBefore(before)) {
          await left.delete(recursive: true);
        }
      } on FileSystemException {
        continue;
      }
    }
  }

  @override
  Future<PickedFile?> pickFile() async {
    final picked = await FilePicker.pickFiles(
      type: FileType.any,
      withReadStream: true,
    );
    final file = picked?.files.firstOrNull;
    final stream = file?.readStream;
    if (file == null || stream == null) return null;
    return _Picked(file.name, file.size, stream);
  }
}

/// A name the bridge sent, as a file name with no folder in it.
String _fileName(String name) {
  final cleaned = name.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]'), '_').trim();
  return cleaned.isEmpty || cleaned.startsWith('.') ? 'session' : cleaned;
}

final class _Downloaded implements DownloadedFile {
  _Downloaded(this._folder, this._file, this._sink);

  final Directory _folder;
  final File _file;
  final IOSink _sink;

  @override
  Future<void> add(Uint8List bytes) async => _sink.add(bytes);

  @override
  Future<void> share({required String mimeType, Rect? origin}) async {
    await _sink.close();
    await Share.shareXFiles([
      XFile(_file.path, mimeType: mimeType),
    ], sharePositionOrigin: origin);
  }

  @override
  Future<void> discard() async {
    await _sink.close();
    if (_folder.existsSync()) await _folder.delete(recursive: true);
  }
}

final class _Picked implements PickedFile {
  const _Picked(this.name, this.size, this._stream);

  @override
  final String name;
  @override
  final int size;
  final Stream<List<int>> _stream;

  @override
  Stream<List<int>> open() => _stream;
}
