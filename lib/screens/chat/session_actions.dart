import 'package:broski/models/message.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/dialogs/share_dialog.dart';
import 'package:broski/screens/diff_view_screen.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Reverts a single message's file changes.
/// Extracted from `_ChatScreenState._revertMessage` in `chat_screen.dart`.
Future<void> revertMessage({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String messageId,
  required String projectPath,
  required HapticsService haptics,
  required VoidCallback onRefreshContext,
  String? partId,
}) async {
  haptics.mediumImpact();
  try {
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.revertMessage(
      sessionId,
      messageId: messageId,
      partId: partId,
      projectPath: projectPath,
    );
    if (!context.mounted) return;
    showSuccess(context, 'Changes reverted');
    onRefreshContext();
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to revert: ${humanizeError(e)}');
  }
}

/// Opens the diff view screen for a single diff entry.
/// Extracted from `_ChatScreenState._openDiffView` in `chat_screen.dart`.
void openDiffView({
  required BuildContext context,
  required DiffEntry diff,
  required Future<void> Function(String messageId, {String? partId}) onUndo,
  String? messageId,
}) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => DiffViewScreen(
        diff: diff,
        messageId: messageId,
        onUndo: (msgId, partId) => onUndo(msgId, partId: partId),
      ),
    ),
  );
}

/// Unreverts (undoes a revert on) the current session.
/// Extracted from `_ChatScreenState._unrevertSession` in `chat_screen.dart`.
Future<void> unrevertSession({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
  required VoidCallback onRefreshContext,
}) async {
  try {
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.unrevertSession(sessionId, projectPath: projectPath);
    if (!context.mounted) return;
    showSuccess(context, 'Revert undone');
    onRefreshContext();
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to undo revert: ${humanizeError(e)}');
  }
}

/// Rewinds Claude Code files to the most recent checkpoint.
/// Extracted from `_ChatScreenState._ccRewindToCheckpoint` in `chat_screen.dart`.
Future<void> ccRewindToCheckpoint({
  required BuildContext context,
  required WidgetRef ref,
  required String effectivePath,
  required HapticsService haptics,
}) async {
  haptics.mediumImpact();
  final ccChatState = ref.read(ccChatProvider);
  if (!ccChatState.canUndo) {
    showSuccess(context, 'No file changes to undo');
    return;
  }
  final remaining = ccChatState.checkpoints.length - 1;
  try {
    final ccChat = ref.read(ccChatProvider.notifier);
    final success = await ccChat.rewindToCheckpoint(cwd: effectivePath);
    if (!context.mounted) return;
    if (success) {
      showSuccess(
        context,
        remaining > 0
            ? 'File changes reverted ($remaining more undo${remaining == 1 ? '' : 's'} available)'
            : 'File changes reverted',
      );
    } else {
      showError(context, 'Failed to revert file changes');
    }
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to revert: ${humanizeError(e)}');
  }
}

/// Shares the current session and shows the share dialog.
/// Extracted from `_ChatScreenState._shareSession` in `chat_screen.dart`.
Future<void> shareSession({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
  required HapticsService haptics,
}) async {
  haptics.mediumImpact();
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final sharedSession = await bridge.shareSession(
      sessionId,
      projectPath: projectPath,
    );
    if (!context.mounted) return;
    final shareUrl = sharedSession.share?.url;
    if (shareUrl == null || shareUrl.isEmpty) {
      showError(context, 'Failed to get share URL');
      return;
    }
    showShareDialog(context, shareUrl);
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to share session: ${humanizeError(e)}');
  }
}

/// Unshares a previously shared session.
/// Extracted from `_ChatScreenState._unshareSession` in `chat_screen.dart`.
Future<void> unshareSession({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
}) async {
  try {
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.unshareSession(sessionId, projectPath: projectPath);
    if (!context.mounted) return;
    showSuccess(context, 'Session is no longer shared');
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to unshare: ${humanizeError(e)}');
  }
}
