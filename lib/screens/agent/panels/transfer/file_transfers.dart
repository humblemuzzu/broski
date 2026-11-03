import 'dart:typed_data';

import 'package:broski/screens/agent/panels/transfer/system_file_transfers.dart';
import 'package:flutter/painting.dart' show Rect;
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A file arriving from the Mac, written to the phone as its parts come, then
/// handed to the system's share sheet.
abstract interface class DownloadedFile {
  Future<void> add(Uint8List bytes);

  /// Ends the file and opens the share sheet for it; [origin] is where an iPad
  /// anchors the sheet.
  Future<void> share({required String mimeType, Rect? origin});

  /// Ends the file and removes it.
  Future<void> discard();
}

/// A file the person chose on the phone, read without holding it whole.
abstract interface class PickedFile {
  String get name;
  int get size;
  Stream<List<int>> open();
}

/// What the generic screens need of the phone's files: somewhere to put a
/// download and a way to choose a file. The real one is
/// `SystemFileTransfers`; tests give one that holds bytes in memory.
abstract interface class FileTransfers {
  Future<DownloadedFile> startDownload(String name);

  /// Null when the person chooses nothing.
  Future<PickedFile?> pickFile();
}

final fileTransfersProvider = Provider<FileTransfers>(
  (ref) => const SystemFileTransfers(),
);
