import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/load_earlier.dart';
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
  if (sessionPath == null || sessionPath.isEmpty || sessionId.isEmpty) {
    chat.hydratePiTranscript(
      await piBridge.getMessages(projectPath: projectPath),
    );
    chat.setTranscriptCursor(null);
    return false;
  }

  final page = await piBridge.readSessionMessagesPage(
    sessionPath: sessionPath,
    sessionId: sessionId,
    limit: kTranscriptPageLimit,
  );
  chat.hydratePiTranscript(page.items);
  chat.setTranscriptCursor(page.nextCursor);
  return page.hasOlder;
}

/// Starts the live Pi instance behind an already-hydrated transcript and refreshes the model state.
///
/// Every step is dropped once the chat has moved on to another session, so a slow switch cannot
/// overwrite the transcript the user is now reading.
Future<void> startPiLiveInstance({
  required PiBridgeService piBridge,
  required ChatSessionNotifier chat,
  required String sessionId,
  required String sessionPath,
  required String projectPath,
  required bool loadMessages,
}) async {
  if (!chat.ownsTranscript(sessionId)) return;
  try {
    await piBridge.switchSession(
      sessionPath: sessionPath,
      projectPath: projectPath,
    );
  } catch (_) {
    // Best effort
  }
  if (!chat.ownsTranscript(sessionId)) return;
  if (loadMessages) {
    try {
      final items = await piBridge.getMessages(projectPath: projectPath);
      if (!chat.ownsTranscript(sessionId)) return;
      chat.hydratePiTranscript(items);
    } catch (_) {
      // Best effort
    }
  }
  if (!chat.ownsTranscript(sessionId)) return;
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
}
