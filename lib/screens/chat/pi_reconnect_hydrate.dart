import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/services/bridge/transcript_page_fetch.dart';
import 'package:broski/services/pi_bridge_service.dart';

/// Re-syncs a Pi chat after a reconnect: one page of the transcript plus the cursor for the page
/// before it, so "load earlier" keeps working from the re-hydrated window. Returns whether the
/// bridge still has messages older than that page.
Future<bool> hydratePiAfterReconnect({
  required PiBridgeService piBridge,
  required ChatSessionNotifier chat,
  required String? sessionPath,
  required String sessionId,
  required String projectPath,
}) async {
  if (sessionId.isEmpty) {
    return false;
  }
  final page = await fetchTranscriptPage(
    (limit) => piBridge.readSessionMessagesPage(
      sessionPath: sessionPath,
      sessionId: sessionId,
      limit: limit,
    ),
    limit: kTranscriptPageLimit,
  );
  chat.hydratePiTranscript(page.items);
  chat.setTranscriptCursor(page.nextCursor);
  return page.hasOlder;
}

/// Starts the live Pi instance behind an already-hydrated transcript and refreshes the model state.
///
/// [loadMessages] re-reads the transcript through the same paged read the fast path uses, so a
/// transcript too large for one reply shrinks to a page that fits instead of failing the chat.
/// Returns whether older messages remain beyond what it loaded; null when it loaded nothing.
///
/// Every step is dropped once the chat has moved on to another session, so a slow switch cannot
/// overwrite the transcript the user is now reading.
Future<bool?> startPiLiveInstance({
  required PiBridgeService piBridge,
  required ChatSessionNotifier chat,
  required String sessionId,
  required String sessionPath,
  required String projectPath,
  required bool loadMessages,
}) async {
  if (!chat.ownsTranscript(sessionId)) return null;
  try {
    await piBridge.switchSession(
      sessionPath: sessionPath,
      projectPath: projectPath,
    );
  } catch (_) {
    // Best effort
  }
  bool? hasOlder;
  if (loadMessages) {
    if (!chat.ownsTranscript(sessionId)) return null;
    final page = await fetchTranscriptPage(
      (limit) => piBridge.readSessionMessagesPage(
        sessionPath: sessionPath,
        sessionId: sessionId,
        limit: limit,
      ),
      limit: kTranscriptPageLimit,
    );
    if (!chat.ownsTranscript(sessionId)) return null;
    chat.hydratePiTranscript(page.items);
    chat.setTranscriptCursor(page.nextCursor);
    hasOlder = page.hasOlder;
  }
  if (!chat.ownsTranscript(sessionId)) return hasOlder;
  try {
    final piState = await piBridge.getState(projectPath: projectPath);
    chat.setPiModel(
      piState.model != null
          ? '${piState.model!.provider}/${piState.model!.id}'
          : null,
      modelData: piState.model,
    );
    chat.setPiThinkingLevel(piState.thinkingLevel);
  } catch (_) {
    // Best effort
  }
  return hasOlder;
}
