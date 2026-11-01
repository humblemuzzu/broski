import 'dart:io';

import 'package:broski/agent/cache/text_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart'
    show getApplicationSupportDirectory;

/// Where each machine's offline cache lies: a directory of its own under one
/// root in the app's support directory, so one machine's entries never answer
/// for another's, forgetting a machine removes its directory, and clearing the
/// cache removes the root. Like the cache, removing is best effort: a
/// directory that cannot be removed costs the space, never the app.
final class CacheDirectories {
  const CacheDirectories(this._root);

  final Future<Directory> Function() _root;

  TextStore storeFor(String machineId) =>
      FileTextStore(() => _directoryOf(machineId));

  Future<void> forget(String machineId) =>
      _deleteIfThere(() => _directoryOf(machineId));

  Future<void> clearAll() => _deleteIfThere(_root);

  Future<Directory> _directoryOf(String machineId) async =>
      Directory('${(await _root()).path}/${_nameOf(machineId)}');

  static Future<void> _deleteIfThere(Future<Directory> Function() find) async {
    try {
      final directory = await find();
      if (await directory.exists()) await directory.delete(recursive: true);
    } on Object {
      return;
    }
  }

  /// A file name for any machine id, whatever characters it holds.
  static String _nameOf(String machineId) {
    var hash = 0xcbf29ce484222325;
    for (final unit in machineId.codeUnits) {
      hash = (hash ^ unit) * 0x100000001b3;
    }
    return 'm${hash.toUnsigned(64).toRadixString(16)}';
  }
}

final cacheDirectoriesProvider = Provider<CacheDirectories>(
  (ref) => CacheDirectories(
    () async => Directory(
      '${(await getApplicationSupportDirectory()).path}/agent_cache',
    ),
  ),
);
