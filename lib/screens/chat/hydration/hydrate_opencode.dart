import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/hydration/hydration.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/services/bridge/transcript_page_fetch.dart';

/// The newest page of an OpenCode session, or the cache when the bridge cannot
/// be reached.
Future<bool> hydrateOpenCode(Hydration h) async {
  final ref = h.ref;
  final widget = h.widget;
  final chat = h.chat;
  final connection = ref.read(connectionProvider);
  final storage = ref.read(storageServiceProvider);
  final setPaginationState = h.setPaginationState;
  final scrollToBottom = h.scrollToBottom;
  // OpenCode mode
  chat.setSession(widget.session, projectPath: widget.project.path);
  if (connection.isOfflineMode) {
    final cachedMessages = await storage.getCachedMessages(widget.session.id);
    if (cachedMessages.isNotEmpty) {
      chat.hydrate(cachedMessages.map((m) => messageToRaw(m)).toList());
    }
    setPaginationState(loadingMore: false, loadedAll: true);
    scrollToBottom(animate: false);
    return false;
  }
  final bridge = ref.read(bridgeServiceProvider);
  var ocHasOlder = false;
  var ocHydrated = false;
  try {
    final page = await fetchTranscriptPage(
      (limit) => bridge.pageSessionMessages(
        widget.session.id,
        projectPath: widget.project.path,
        limit: limit,
      ),
      limit: kTranscriptPageLimit,
    );
    chat.hydrate(page.items);
    // The page's cursor names the messages before it, so scroll-to-top asks for
    // exactly one older page instead of the whole session.
    chat.setTranscriptSession(widget.session.id);
    chat.setTranscriptCursor(page.nextCursor);
    ocHasOlder = page.hasOlder;
    ocHydrated = true;
  } catch (_) {
    transcriptUnavailable();
    final cached = await storage.getCachedMessages(widget.session.id);
    if (cached.isNotEmpty) {
      chat.hydrate(cached.map((m) => messageToRaw(m)).toList());
    }
  }
  setPaginationState(loadingMore: false, loadedAll: ocHydrated && !ocHasOlder);
  scrollToBottom(animate: false);
  // Cache messages for offline use
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isNotEmpty) {
    await storage.cacheSessionMessages(widget.session.id, chatState.messages);
  }
  return true; // Call _loadSessionContext
}
