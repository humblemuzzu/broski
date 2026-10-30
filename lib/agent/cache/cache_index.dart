import 'dart:convert';

/// The entries the offline cache holds, newest write first, with the size of
/// each, so the cache can stay inside its budget (nothing else lists the keys
/// of a secure store).
final class CacheIndex {
  const CacheIndex(this.entries);

  factory CacheIndex.parse(String? text) {
    if (text == null) return const CacheIndex([]);
    final decoded = jsonDecode(text);
    if (decoded is! List) return const CacheIndex([]);
    return CacheIndex([
      for (final entry in decoded)
        if (entry case {'k': final String key, 'n': final int size})
          CacheEntry(key, size),
    ]);
  }

  final List<CacheEntry> entries;

  /// [key] first, then the entries that fit [maxEntries] and [maxChars]; the
  /// second list holds the keys that no longer fit.
  (CacheIndex, List<String>) withWrite(
    CacheEntry written, {
    required int maxEntries,
    required int maxChars,
  }) {
    final kept = <CacheEntry>[written];
    final dropped = <String>[];
    var chars = written.size;
    for (final entry in entries) {
      if (entry.key == written.key) continue;
      final fits = kept.length < maxEntries && chars + entry.size <= maxChars;
      if (fits) {
        kept.add(entry);
        chars += entry.size;
      } else {
        dropped.add(entry.key);
      }
    }
    return (CacheIndex(kept), dropped);
  }

  String encode() => jsonEncode([
    for (final entry in entries) {'k': entry.key, 'n': entry.size},
  ]);
}

final class CacheEntry {
  const CacheEntry(this.key, this.size);

  final String key;
  final int size;
}
