import 'dart:io';

/// Where the offline cache keeps its entries: text under a key.
abstract interface class TextStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}

/// One file per key in a directory of the app's own, found at the first use
/// and made at the first write. A key is a file name (the cache makes it one);
/// a write goes to a file beside it first and is renamed into place, so a
/// reader never sees half of one.
final class FileTextStore implements TextStore {
  FileTextStore(this._directory);

  final Future<Directory> Function() _directory;

  @override
  Future<String?> read(String key) async {
    final file = File('${(await _directory()).path}/$key');
    return await file.exists() ? file.readAsString() : null;
  }

  @override
  Future<void> write(String key, String value) async {
    final directory = await (await _directory()).create(recursive: true);
    final written = File('${directory.path}/$key.writing');
    await written.writeAsString(value, flush: true);
    await written.rename('${directory.path}/$key');
  }

  @override
  Future<void> delete(String key) async {
    final file = File('${(await _directory()).path}/$key');
    if (await file.exists()) await file.delete();
  }
}
