import 'package:broski/models/transcript_page.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
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
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
}) async {
  if (loadingMoreMessages || hasLoadedAllMessages) return;
  if (!supportsTranscriptPaging(widget)) return;

  final chat = ref.read(chatSessionProvider.notifier);
  final cursor = chat.transcriptCursor;
  if (cursor == null) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }
  if (ref.read(connectionProvider).isOfflineMode) {
    setPaginationState(loadingMore: false, loadedAll: false);
    return;
  }

  setPaginationState(loadingMore: true, loadedAll: false);
  final offsetBefore = scrollController.hasClients
      ? scrollController.position.pixels
      : 0.0;
  final extentBefore = scrollController.hasClients
      ? scrollController.position.maxScrollExtent
      : 0.0;

  try {
    final hasOlder = await _fetchAndPrepend(ref, widget, cursor);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!scrollController.hasClients) return;
      scrollController.jumpTo(
        preservedScrollOffset(
          currentOffset: offsetBefore,
          maxExtentBefore: extentBefore,
          maxExtentAfter: scrollController.position.maxScrollExtent,
        ),
      );
    });

    setPaginationState(loadingMore: false, loadedAll: !hasOlder);
  } catch (_) {
    setPaginationState(loadingMore: false, loadedAll: false);
  }
}

Future<bool> _fetchAndPrepend(
  WidgetRef ref,
  ChatScreen widget,
  String cursor,
) async {
  final chat = ref.read(chatSessionProvider.notifier);
  final bridge = ref.read(bridgeServiceProvider);

  if (widget.isClaudeCode) {
    final page = await bridge.ccGetSessionMessagesPage(
      widget.ccSession?.id ?? '',
      cwd: widget.ccSession?.cwd ?? widget.ccDraftCwd ?? '',
      limit: kTranscriptPageLimit,
      before: cursor,
    );
    chat.prependClaudeCodeTranscript(
      page.items,
      sessionId: widget.ccSession?.id ?? '',
    );
    chat.setTranscriptCursor(page.nextCursor);
    return page.hasOlder;
  }

  if (widget.isCodex) {
    final page = await bridge.cxGetThreadMessagesPage(
      widget.cxThread?.id ?? '',
      limit: kTranscriptPageLimit,
      before: cursor,
    );
    chat.prependCodexTranscript(
      page.items,
      threadId: widget.cxThread?.id ?? '',
    );
    chat.setTranscriptCursor(page.nextCursor);
    return page.hasOlder;
  }

  final page = await ref
      .read(piBridgeServiceProvider)
      .readSessionMessagesPage(
        sessionPath: widget.piSession?.path,
        sessionId: widget.piSession?.id,
        limit: kTranscriptPageLimit,
        before: cursor,
      );
  chat.prependPiTranscript(
    page.items,
    idPrefix: widget.isPiDurable ? 'pd' : 'pi',
  );
  chat.setTranscriptCursor(page.nextCursor);
  return page.hasOlder;
}
