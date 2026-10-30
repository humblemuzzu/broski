import 'package:broski/agent/cache/text_store.dart';

/// A [TextStore] in memory, shared between rigs to play an app restart.
final class MemoryTextStore implements TextStore {
  final Map<String, String> entries = {};
  bool failing = false;

  @override
  Future<String?> read(String key) async {
    if (failing) throw StateError('the store is gone');
    return entries[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (failing) throw StateError('the store is gone');
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    if (failing) throw StateError('the store is gone');
    entries.remove(key);
  }
}
