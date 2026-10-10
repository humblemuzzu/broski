part of '../chat_provider.dart';

/// Cursor bookkeeping for "load earlier" pages of the open transcript.
///
/// Null means there is nothing older to ask for: either the bridge sent the whole transcript, or
/// the open chat's backend does not page.
extension TranscriptPaging on ChatSessionNotifier {
  String? get transcriptCursor => _transcriptCursor;

  /// The session the open transcript belongs to, set when a session is opened.
  String? get transcriptSessionId => _transcriptSessionId;

  /// Whether [sessionId] is still the session the loaded window belongs to.
  bool ownsTranscript(String? sessionId) => sessionId == _transcriptSessionId;

  void setTranscriptCursor(String? cursor) {
    _transcriptCursor = cursor;
  }

  void setTranscriptSession(String? sessionId) {
    _transcriptSessionId = sessionId;
  }
}
