part of '../chat_provider.dart';

/// Cursor bookkeeping for "load earlier" pages of the open transcript.
///
/// Null means there is nothing older to ask for: either the bridge sent the whole transcript, or
/// the open chat's backend does not page.
extension TranscriptPaging on ChatSessionNotifier {
  String? get transcriptCursor => _transcriptCursor;

  void setTranscriptCursor(String? cursor) {
    _transcriptCursor = cursor;
  }
}
