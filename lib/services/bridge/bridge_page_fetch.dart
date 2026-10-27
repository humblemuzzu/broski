import 'dart:math';

import 'package:broski/services/bridge/bridge_response_error.dart';

/// How small a page a retry will ask for before giving up.
const int kMinBridgePageLimit = 8;

/// Fetches one page, asking for less when the bridge refuses to put the reply on
/// the wire because it is too large.
///
/// Without this a long transcript or a large session list is unusable over the
/// link: the bridge answers `response_too_large` and the caller would show a
/// failure instead of the page that does fit.
Future<T> fetchBridgePage<T>(
  Future<T> Function(int limit) fetch, {
  required int limit,
}) async {
  var attempt = limit;
  while (true) {
    try {
      return await fetch(attempt);
    } on BridgeResponseTooLargeException {
      if (attempt <= kMinBridgePageLimit) {
        rethrow;
      }
      attempt = max(kMinBridgePageLimit, attempt ~/ 4);
    }
  }
}
