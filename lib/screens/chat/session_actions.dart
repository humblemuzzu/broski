import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/claude_code_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/haptics_service.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../dialogs/share_dialog.dart';
import '../diff_view_screen.dart';

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
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Changes reverted'),
        backgroundColor: theme.backgroundPanel,
      ),
    );
    onRefreshContext();
  } catch (e) {
    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to revert: ${humanizeError(e)}'),
        backgroundColor: theme.error,
      ),
    );
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
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Revert undone'),
        backgroundColor: theme.backgroundPanel,
      ),
    );
    onRefreshContext();
  } catch (e) {
    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to undo revert: ${humanizeError(e)}'),
        backgroundColor: theme.error,
      ),
    );
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
  final theme = OpenCodeTheme.of(context);
  final ccChatState = ref.read(ccChatProvider);
  if (!ccChatState.canUndo) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('No file changes to undo'),
        backgroundColor: theme.backgroundPanel,
      ),
    );
    return;
  }
  final remaining = ccChatState.checkpoints.length - 1;
  try {
    final ccChat = ref.read(ccChatProvider.notifier);
    final success = await ccChat.rewindToCheckpoint(cwd: effectivePath);
    if (!context.mounted) return;
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            remaining > 0
                ? 'File changes reverted ($remaining more undo${remaining == 1 ? '' : 's'} available)'
                : 'File changes reverted',
          ),
          backgroundColor: theme.backgroundPanel,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to revert file changes'),
          backgroundColor: theme.error,
        ),
      );
    }
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to revert: ${humanizeError(e)}'),
        backgroundColor: theme.error,
      ),
    );
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
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to get share URL'),
          backgroundColor: theme.error,
        ),
      );
      return;
    }
    showShareDialog(context, shareUrl);
  } catch (e) {
    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to share session: ${humanizeError(e)}'),
        backgroundColor: theme.error,
      ),
    );
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
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Session is no longer shared'),
        backgroundColor: theme.backgroundPanel,
      ),
    );
  } catch (e) {
    if (!context.mounted) return;
    final theme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to unshare: ${humanizeError(e)}'),
        backgroundColor: theme.error,
      ),
    );
  }
}
