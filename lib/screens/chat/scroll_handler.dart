import 'package:broski/providers/chat_provider.dart';
import 'package:broski/screens/chat/load_earlier.dart';
import 'package:broski/screens/chat/mcp_oauth_snackbar.dart';
import 'package:broski/screens/chat/transcript_scroll_anchor.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Handle auto-scroll when new content arrives.
/// Only scrolls if user hasn't intentionally scrolled up.
/// Extracted from `_ChatScreenState._handleAutoScroll`.
void handleAutoScroll({
  required BuildContext context,
  required bool isOpenCode,
  required ChatSessionState? previous,
  required ChatSessionState next,
  required bool userHasScrolledUp,
  required int previousMessageCount,
  required int previousContentLength,
  required void Function(int) setPreviousMessageCount,
  required void Function(int) setPreviousContentLength,
  required void Function({bool animate}) scrollToBottom,
  required String? lastShownMcpOAuthUrl,
  required void Function(String?) setLastShownMcpOAuthUrl,
}) {
  if (isOpenCode) {
    setLastShownMcpOAuthUrl(
      maybeShowMcpOAuthFailureSnackbar(
        context: context,
        previous: previous?.mcpOAuthPending,
        next: next.mcpOAuthPending,
        lastShownUrl: lastShownMcpOAuthUrl,
      ),
    );
  }

  if (userHasScrolledUp) return;
  final messages = next.messages;
  final currentCount = messages.length;
  final currentLength = next.contentLength;
  final hasNewMessage = currentCount > previousMessageCount;
  final hasNewContent = currentLength > previousContentLength;
  final isStreaming = messages.any((msg) => msg.isStreaming);
  final hasRunningTools = messages.any(
    (msg) => msg.toolCalls.any(
      (tool) =>
          tool.status.toLowerCase() == 'running' ||
          tool.status.toLowerCase() == 'pending',
    ),
  );
  setPreviousMessageCount(currentCount);
  setPreviousContentLength(currentLength);
  if (hasNewMessage || hasNewContent || isStreaming || hasRunningTools) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (userHasScrolledUp) return;
      if (isStreaming || hasRunningTools) {
        scrollToBottom(animate: false);
      } else {
        scrollToBottom(animate: true);
      }
    });
  }
}

/// Loads the page of messages older than the loaded window when the user
/// scrolls to the top. Every backend pages, OpenCode included: one frame is all
/// a long chat's whole transcript would ever be.
Future<void> loadMoreMessages({
  required WidgetRef ref,
  required bool loadingMoreMessages,
  required bool hasLoadedAllMessages,
  required String sessionId,
  required String projectPath,
  required ScrollController scrollController,
  required TranscriptAnchorKeys anchorKeys,
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
  required bool Function() isMounted,
  ChatScreen? widget,
}) async {
  final screen = widget;
  if (screen == null || !supportsTranscriptPaging(screen)) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }
  final chat = ref.read(chatSessionProvider.notifier);
  // The user can leave a chat while a page is still loading: a page for the
  // session or project they left would land in the wrong window.
  if (sessionId != chat.transcriptSessionId ||
      projectPath != screen.project.path) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }
  await loadEarlierTranscript(
    ref: ref,
    widget: screen,
    loadingMoreMessages: loadingMoreMessages,
    hasLoadedAllMessages: hasLoadedAllMessages,
    scrollController: scrollController,
    anchorKeys: anchorKeys,
    setPaginationState: ({required bool loadingMore, required bool loadedAll}) {
      if (!isMounted()) return;
      setPaginationState(loadingMore: loadingMore, loadedAll: loadedAll);
    },
  );
}
