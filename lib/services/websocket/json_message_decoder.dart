import 'dart:convert';

import 'package:flutter/foundation.dart' show compute;

/// Decodes JSON strings into maps.
///
/// Uses background isolate (via compute) for large payloads to avoid
/// blocking the UI thread. Small payloads decode synchronously since
/// the isolate spawn overhead would exceed the decode cost.
class WebSocketJsonMessageDecoder {
  static const int _offloadThreshold = 4096;

  Future<Map<String, dynamic>> decode(String raw) async {
    if (raw.length > _offloadThreshold) {
      return compute(_decodeJsonMap, raw);
    }
    return _decodeJsonMap(raw);
  }

  void dispose() {
    // No persistent resources to clean up with compute().
  }
}

Map<String, dynamic> _decodeJsonMap(String raw) {
  final decoded = jsonDecode(raw);
  return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
}
