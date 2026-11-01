import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/hydration/hydration.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/services/bridge/bridge_page_fetch.dart';

/// The newest page of a Claude Code transcript, or the cache when the bridge
/// cannot be reached.
Future<bool> hydrateClaudeCode(Hydration h) async {
  final ref = h.ref;
  final widget = h.widget;
  final chat = h.chat;
  final connection = ref.read(connectionProvider);
  final storage = ref.read(storageServiceProvider);
  final setPaginationState = h.setPaginationState;
  final scrollToBottom = h.scrollToBottom;
  final cwd = widget.ccSession?.cwd ?? widget.ccDraftCwd ?? '';
  chat.setCCSession(
    sessionId: widget.ccSession?.id ?? '',
    cwd: cwd,
    model: widget.ccSession?.model ?? widget.ccDraftModel,
    title: widget.ccSession?.displayTitle ?? widget.ccDraftTitle,
  );
  final sessionId = widget.ccSession?.id;
  final parentSessionId = widget.ccSession?.parentSessionId;
  final isSubagent = widget.ccSession?.isSubagentSession == true;
  var ccHasOlder = false;
  var ccHydrated = false;
  if (sessionId != null && sessionId.isNotEmpty) {
    if (connection.isOfflineMode) {
      final cachedMessages = await storage.getCachedCCMessages(sessionId);
      if (cachedMessages.isNotEmpty) {
        chat.hydrateCached(cachedMessages);
      }
    } else {
      try {
        final bridge = ref.read(bridgeServiceProvider);
        if (isSubagent) {
          // Load subagent messages using parent session ID + agent ID
          final items = await bridge.ccGetSubagentMessages(
            sessionId: parentSessionId!,
            agentId: sessionId,
            cwd: cwd,
          );
          chat.hydrateClaudeCodeTranscript(items);
        } else {
          final page = await fetchBridgePage(
            (limit) => bridge.ccGetSessionMessagesPage(
              sessionId,
              cwd: cwd,
              limit: limit,
            ),
            limit: kTranscriptPageLimit,
          );
          chat.hydrateClaudeCodeTranscript(page.items);
          chat.setTranscriptCursor(page.nextCursor);
          ccHasOlder = page.hasOlder;
        }
        ccHydrated = true;
        final chatState = ref.read(chatSessionProvider);
        if (chatState.messages.isNotEmpty) {
          await storage.cacheCCSessionMessages(sessionId, chatState.messages);
        }
      } catch (_) {
        transcriptUnavailable();
        final cachedMessages = await storage.getCachedCCMessages(sessionId);
        if (cachedMessages.isNotEmpty) {
          chat.hydrateCached(cachedMessages);
        }
      }
    }
  }
  scrollToBottom(animate: false);
  setPaginationState(loadingMore: false, loadedAll: ccHydrated && !ccHasOlder);
  return false; // No need to call _loadSessionContext for CC initial hydrate
}
