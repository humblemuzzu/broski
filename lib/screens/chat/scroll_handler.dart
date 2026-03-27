import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/connection_provider.dart';
import 'mcp_oauth_snackbar.dart';

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

/// Load more messages when user scrolls to top.
/// Extracted from `_ChatScreenState._loadMoreMessages`.
Future<void> loadMoreMessages({
  required WidgetRef ref,
  required bool loadingMoreMessages,
  required bool hasLoadedAllMessages,
  required String sessionId,
  required String projectPath,
  required ScrollController scrollController,
  required void Function({required bool loadingMore, required bool loadedAll})
  setPaginationState,
  required bool Function() isMounted,
}) async {
  if (loadingMoreMessages || hasLoadedAllMessages) return;
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    setPaginationState(loadingMore: false, loadedAll: true);
    return;
  }
  setPaginationState(loadingMore: true, loadedAll: false);
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final allMessages = await bridge.getSessionMessages(
      sessionId,
      projectPath: projectPath,
    );
    final currentOffset = scrollController.position.pixels;
    final currentMax = scrollController.position.maxScrollExtent;
    chat.hydrate(allMessages);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (scrollController.hasClients) {
        final newMax = scrollController.position.maxScrollExtent;
        final addedHeight = newMax - currentMax;
        scrollController.jumpTo(currentOffset + addedHeight);
      }
    });
    setPaginationState(loadingMore: false, loadedAll: true);
  } catch (e) {
    setPaginationState(loadingMore: false, loadedAll: false);
  }
}
