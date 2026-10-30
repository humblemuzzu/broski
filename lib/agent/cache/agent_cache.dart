import 'dart:async';
import 'dart:convert';

import 'package:broski/agent/cache/cache_index.dart';
import 'package:broski/agent/cache/text_store.dart';
import 'package:broski/agent/client/agent_clock.dart';

/// A cached value and when it was saved (milliseconds since the epoch).
final class Saved<T> {
  const Saved(this.value, this.savedAt);

  final T value;
  final int savedAt;
}

/// The last data the phone read from the bridge, kept for the times the link
/// is down (stale-while-revalidate): session lists, finished transcripts, the
/// backends and the directories their sessions use. It is bounded as a whole
/// (entries, characters in all, characters in each), the oldest write goes first, and it
/// is best effort: a store that fails, or an entry another version wrote, is
/// a miss, never an error.
final class AgentCache {
  AgentCache(this._store, {AgentClock clock = const SystemClock()})
    : _clock = clock;

  static const maxEntries = 24;
  static const maxChars = 2 * 1024 * 1024;
  static const maxEntryChars = 192 * 1024;
  static const _version = 1;
  static const _indexKey = 'broski_agent_cache_index';
  static const _prefix = 'broski_agent_cache_';

  final TextStore _store;
  final AgentClock _clock;
  Future<void> _writes = Future<void>.value();

  /// The value saved under [name], decoded with [decode]; null when there is
  /// none, it cannot be read, or [decode] refuses it.
  Future<Saved<T>?> read<T>(
    String name,
    T Function(Object? data) decode,
  ) async {
    try {
      final text = await _store.read(_storageKey(name));
      if (text == null) return null;
      final envelope = jsonDecode(text);
      if (envelope case {
        'v': _version,
        'k': final String key,
        'at': final int savedAt,
        'data': final Object? data,
      } when key == name) {
        return Saved(decode(data), savedAt);
      }
    } on Object {
      return null;
    }
    return null;
  }

  /// Saves [data] under [name] unless it alone is over the entry bound;
  /// completes once it is written. Writes happen one at a time.
  Future<void> write(String name, Object? data) {
    final next = _writes.then((_) => _put(name, data));
    _writes = next;
    return next;
  }

  Future<void> _put(String name, Object? data) async {
    try {
      final text = jsonEncode({
        'v': _version,
        'k': name,
        'at': _clock.now().millisecondsSinceEpoch,
        'data': data,
      });
      if (text.length > maxEntryChars) return;
      final key = _storageKey(name);
      await _store.write(key, text);
      final index = CacheIndex.parse(await _store.read(_indexKey));
      final (kept, dropped) = index.withWrite(
        CacheEntry(key, text.length),
        maxEntries: maxEntries,
        maxChars: maxChars,
      );
      await _store.write(_indexKey, kept.encode());
      for (final old in dropped) {
        await _store.delete(old);
      }
    } on Object {
      return;
    }
  }

  /// Everything the cache holds, gone.
  Future<void> clear() {
    final next = _writes.then((_) async {
      try {
        final index = CacheIndex.parse(await _store.read(_indexKey));
        for (final entry in index.entries) {
          await _store.delete(entry.key);
        }
        await _store.delete(_indexKey);
      } on Object {
        return;
      }
    });
    _writes = next;
    return next;
  }

  /// The key an entry named [name] is stored under: fixed length whatever the
  /// name (a session id may be a path), the name itself kept inside the entry
  /// so two names that hash alike cannot be taken for one another.
  static String _storageKey(String name) {
    var hash = 0xcbf29ce484222325;
    for (final unit in name.codeUnits) {
      hash = (hash ^ unit) * 0x100000001b3;
    }
    return '$_prefix${hash.toUnsigned(64).toRadixString(16)}';
  }
}
