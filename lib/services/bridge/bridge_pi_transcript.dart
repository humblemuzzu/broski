import 'package:broski/models/transcript_page.dart';
import 'package:broski/services/pi_bridge_service.dart';

/// Paged Pi transcript reads.
///
/// [readSessionMessages] answers with the whole transcript; this asks for one page plus the cursor
/// for the page before it.
extension PiBridgeTranscriptPages on PiBridgeService {
  Future<TranscriptPage<Map<String, dynamic>>> readSessionMessagesPage({
    String? sessionPath,
    String? sessionId,
    int? limit,
    String? before,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_read_session_messages',
      'requestId': requestId,
      if (sessionPath != null) 'sessionPath': sessionPath,
      if (sessionId != null) 'sessionId': sessionId,
      if (limit != null) 'limit': limit,
      if (before != null) 'before': before,
    });

    final response = await waitForResponse(
      'pi_session_messages',
      requestId: requestId,
    );
    final data = response['data'] as List<dynamic>? ?? const [];
    return TranscriptPage.fromResponse(
      response,
      data.whereType<Map<String, dynamic>>().toList(),
    );
  }
}
