import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/hydration/hydration.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/services/bridge/bridge_page_fetch.dart';

/// The newest page of a Codex thread, or the cache when the bridge cannot be
/// reached.
Future<bool> hydrateCodex(Hydration h) async {
  final ref = h.ref;
  final widget = h.widget;
  final chat = h.chat;
  final connection = ref.read(connectionProvider);
  final storage = ref.read(storageServiceProvider);
  final setPaginationState = h.setPaginationState;
  final scrollToBottom = h.scrollToBottom;
  final cwd = widget.cxThread?.cwd ?? widget.cxDraftCwd ?? '';
  final threadId = widget.cxThread?.id ?? '';
  var cxHasOlder = false;
  var cxHydrated = false;
  chat.setCodexThread(
    threadId: threadId,
    cwd: cwd,
    model: widget.cxThread?.modelProvider ?? widget.cxDraftModel,
  );
  if (threadId.isNotEmpty) {
    if (connection.isOfflineMode) {
      final cached = await storage.getCachedCodexMessages(threadId);
      if (cached.isNotEmpty) {
        chat.hydrate(cached.map((m) => messageToRaw(m)).toList());
      }
    } else {
      try {
        final bridge = ref.read(bridgeServiceProvider);
        final page = await fetchBridgePage(
          (limit) => bridge.cxGetThreadMessagesPage(threadId, limit: limit),
          limit: kTranscriptPageLimit,
        );
        chat.hydrateCodexTranscript(page.items);
        chat.setTranscriptCursor(page.nextCursor);
        cxHasOlder = page.hasOlder;
        cxHydrated = true;
        final chatState = ref.read(chatSessionProvider);
        if (chatState.messages.isNotEmpty) {
          await storage.cacheCodexThreadMessages(threadId, chatState.messages);
        }
      } catch (_) {
        transcriptUnavailable();
        final cached = await storage.getCachedCodexMessages(threadId);
        if (cached.isNotEmpty) {
          chat.hydrate(cached.map((m) => messageToRaw(m)).toList());
        }
      }
    }
  }
  scrollToBottom(animate: false);
  setPaginationState(loadingMore: false, loadedAll: cxHydrated && !cxHasOlder);
  return false;
}
