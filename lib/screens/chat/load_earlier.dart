import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/transcript_scroll_anchor.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/services/bridge/bridge_pi_transcript.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Messages the app asks for when a chat opens, and for each "load earlier" page.
///
/// A phone shows a handful of message cards at once, so 60 covers several screens of history plus
/// the buffer the user reads back through; deeper history is one page away.
const int kTranscriptPageLimit = 60;

/// Whether the open chat loads older messages a page at a time.
bool supportsTranscriptPaging(ChatScreen widget) =>
    widget.isPi || widget.isClaudeCode || widget.isCodex;

/// Fetches the page of messages older than the loaded window and prepends it, keeping the message
/// under the viewport in place.
Future<void> loadEarlierTranscript({
  required WidgetRef ref,
  required ChatScreen widget,
  required bool loadingMoreMessages,
  required bool hasLoadedAllMessages,
  required ScrollController scrollController,
  required TranscriptAnchorKeys anchorKeys,
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
}) async {
  if (loadingMoreMessages || hasLoadedAllMessages) return;
  if (!supportsTranscriptPaging(widget)) return;

  final chat = ref.read(chatSessionProvider.notifier);
  final cursor = chat.transcriptCursor;
  final sessionId = chat.transcriptSessionId;
  if (cursor == null) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }
  if (ref.read(connectionProvider).isOfflineMode) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }

  setPaginationState(loadingMore: true, loadedAll: false);
  final anchor = captureTranscriptAnchor(
    messageIds: ref
        .read(chatSessionProvider)
        .messages
        .map((message) => message.id)
        .toList(growable: false),
    keys: anchorKeys,
  );

  try {
    final page = await _fetchAndPrepend(
      ref,
      widget,
      cursor,
      sessionId,
      scrollController,
    );
    if (page == null) return;

    if (scrollController.hasClients) {
      await restoreTranscriptScroll(
        controller: scrollController,
        keys: anchorKeys,
        anchor: anchor,
        offsetBefore: page.offsetAtPrepend,
        extentBefore: page.extentAtPrepend,
      );
    }

    setPaginationState(loadingMore: false, loadedAll: !page.hasOlder);
  } catch (_) {
    setPaginationState(loadingMore: false, loadedAll: false);
  }
}

/// Fetches and prepends one page, or null when the transcript moved to another session while the
/// page was in flight and the reply no longer belongs to the open chat.
Future<({bool hasOlder, double offsetAtPrepend, double extentAtPrepend})?>
_fetchAndPrepend(
  WidgetRef ref,
  ChatScreen widget,
  String cursor,
  String? sessionId,
  ScrollController scrollController,
) async {
  final chat = ref.read(chatSessionProvider.notifier);
  final bridge = ref.read(bridgeServiceProvider);

  if (widget.isClaudeCode) {
    final id = widget.ccSession?.id ?? '';
    final page = await bridge.ccGetSessionMessagesPage(
      id,
      cwd: widget.ccSession?.cwd ?? widget.ccDraftCwd ?? '',
      limit: kTranscriptPageLimit,
      before: cursor,
    );
    if (!chat.ownsTranscript(sessionId)) return null;
    final extent = _extentOf(scrollController);
    chat.prependClaudeCodeTranscript(page.items, sessionId: id);
    chat.setTranscriptCursor(page.nextCursor);
    return (
      hasOlder: page.hasOlder,
      offsetAtPrepend: extent.offset,
      extentAtPrepend: extent.extent,
    );
  }

  if (widget.isCodex) {
    final id = widget.cxThread?.id ?? '';
    final page = await bridge.cxGetThreadMessagesPage(
      id,
      limit: kTranscriptPageLimit,
      before: cursor,
    );
    if (!chat.ownsTranscript(sessionId)) return null;
    final extent = _extentOf(scrollController);
    chat.prependCodexTranscript(page.items, threadId: id);
    chat.setTranscriptCursor(page.nextCursor);
    return (
      hasOlder: page.hasOlder,
      offsetAtPrepend: extent.offset,
      extentAtPrepend: extent.extent,
    );
  }

  final page = await ref
      .read(piBridgeServiceProvider)
      .readSessionMessagesPage(
        sessionPath: widget.piSession?.path,
        sessionId: widget.piSession?.id,
        limit: kTranscriptPageLimit,
        before: cursor,
      );
  if (!chat.ownsTranscript(sessionId)) return null;
  final extent = _extentOf(scrollController);
  chat.prependPiTranscript(
    page.items,
    idPrefix: widget.isPiDurable ? 'pd' : 'pi',
    sessionId: widget.piSession?.id ?? '',
  );
  chat.setTranscriptCursor(page.nextCursor);
  return (
    hasOlder: page.hasOlder,
    offsetAtPrepend: extent.offset,
    extentAtPrepend: extent.extent,
  );
}

/// Offset and maximum scroll extent at the moment the page is inserted, so the scroll shift counts
/// only what the page itself added.
({double offset, double extent}) _extentOf(ScrollController controller) {
  if (!controller.hasClients) return (offset: 0, extent: 0);
  return (
    offset: controller.position.pixels,
    extent: controller.position.maxScrollExtent,
  );
}
