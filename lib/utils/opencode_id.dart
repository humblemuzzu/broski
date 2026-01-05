import 'dart:math';

/// Generates OpenCode-style monotonic IDs.
///
/// This mirrors `Identifier.create()` in OpenCode (Bun/TS) closely enough that
/// lexicographic ordering matches time ordering, which OpenCode relies on when
/// listing messages.
class OpenCodeId {
  static const _base62 =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  static final Random _rand = Random.secure();

  static int _lastTimestampMs = 0;
  static int _counter = 0;

  static String newMessageId() {
    return _create('msg');
  }

  static String _create(String prefix) {
    final tsMs = DateTime.now().millisecondsSinceEpoch;
    if (tsMs != _lastTimestampMs) {
      _lastTimestampMs = tsMs;
      _counter = 0;
    }
    _counter++;

    final now = BigInt.from(tsMs) * BigInt.from(0x1000) + BigInt.from(_counter);

    final timeBytes = List<int>.filled(6, 0);
    for (var i = 0; i < 6; i++) {
      timeBytes[i] = ((now >> (40 - 8 * i)) & BigInt.from(0xff)).toInt() & 0xff;
    }

    final hex = timeBytes
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();

    // OpenCode uses LENGTH=26, and the hex timestamp is 12 chars.
    // Remaining random suffix is 14 chars.
    final rand = _randomBase62(14);
    return '${prefix}_$hex$rand';
  }

  static String _randomBase62(int length) {
    final out = StringBuffer();
    for (var i = 0; i < length; i++) {
      out.write(_base62[_rand.nextInt(_base62.length)]);
    }
    return out.toString();
  }
}
