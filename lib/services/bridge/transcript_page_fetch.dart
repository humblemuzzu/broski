import 'dart:math';

import 'package:broski/models/transcript_page.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';

/// How small a page a retry will ask for before giving up.
const int kMinTranscriptPageLimit = 8;

/// Fetches one transcript page, asking for less when the bridge refuses to put
/// the reply on the wire because it is too large.
///
/// Without this a long transcript is unusable over the link: the bridge answers
/// `response_too_large` and the chat would show a failure instead of the page
/// that does fit.
Future<TranscriptPage<T>> fetchTranscriptPage<T>(
  Future<TranscriptPage<T>> Function(int limit) fetch, {
  required int limit,
}) async {
  var attempt = limit;
  while (true) {
    try {
      return await fetch(attempt);
    } on BridgeResponseTooLargeException {
      if (attempt <= kMinTranscriptPageLimit) {
        rethrow;
      }
      attempt = max(kMinTranscriptPageLimit, attempt ~/ 4);
    }
  }
}
