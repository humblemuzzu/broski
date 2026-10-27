import 'package:broski/models/pi.dart';
import 'package:broski/models/session_page.dart';
import 'package:broski/services/bridge/bridge_page_fetch.dart';
import 'package:broski/services/pi_bridge_service.dart';

/// One page of the Pi session list, with the cursor the page after it starts at.
extension PiBridgeSessionPages on PiBridgeService {
  Future<SessionPage<PiSessionInfo>> listSessionsPage({
    String? projectPath,
    int limit = kSessionPageLimit,
    String? before,
  }) {
    return fetchBridgePage(
      (attempt) => _listSessionsPageOnce(
        projectPath: projectPath,
        limit: attempt,
        before: before,
      ),
      limit: limit,
    );
  }

  Future<SessionPage<PiSessionInfo>> _listSessionsPageOnce({
    required String? projectPath,
    required int limit,
    required String? before,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'pi_list_sessions',
      'requestId': requestId,
      if (projectPath != null) 'projectPath': projectPath,
      'limit': limit,
      if (before != null) 'before': before,
    });

    final response = await waitForResponse('pi_sessions', requestId: requestId);
    return SessionPage.fromResponse(
      response,
      (rows) => rows
          .whereType<Map<String, dynamic>>()
          .map(PiSessionInfo.fromJson)
          .toList(),
    );
  }
}
