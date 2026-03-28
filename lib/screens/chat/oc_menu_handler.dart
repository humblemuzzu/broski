import 'package:broski/models/message.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';

/// Handles OpenCode overflow menu actions (with messages list available).
/// Extracted from `_ChatScreenState._handleMenuActionWithMessages`.
void handleOcMenuAction({
  required BuildContext context,
  required String value,
  required List<ChatMessage> messages,
  required bool isClaudeCode,
  required VoidCallback onStopGeneration,
  required VoidCallback onShowProjectTools,
  required VoidCallback onFork,
  required VoidCallback onShare,
  required VoidCallback onUnshare,
  required VoidCallback onCompact,
  required VoidCallback onInit,
  required Future<void> Function(String, {String? partId}) onRevert,
  required VoidCallback onCcRewind,
  required VoidCallback onClearInstance,
}) {
  switch (value) {
    case 'stop':
      onStopGeneration();
    case 'project_tools':
      onShowProjectTools();
    case 'sidebar':
      Scaffold.of(context).openEndDrawer();
    case 'new_session':
      showSuccess(context, 'New session - coming soon');
    case 'fork':
      onFork();
    case 'share':
      onShare();
    case 'unshare':
      onUnshare();
    case 'compact':
      onCompact();
    case 'init':
      onInit();
    case 'undo':
      if (isClaudeCode) {
        onCcRewind();
      } else {
        ChatMessage? lastEditMessage;
        for (final msg in messages.reversed) {
          if (msg.role == MessageRole.assistant &&
              msg.toolCalls.any(
                (tool) => tool.name == 'edit' || tool.name == 'write',
              )) {
            lastEditMessage = msg;
            break;
          }
        }
        if (lastEditMessage != null) {
          onRevert(lastEditMessage.id);
        } else {
          showSuccess(context, 'No file changes to undo');
        }
      }
    case 'clear_instance':
      onClearInstance();
  }
}
