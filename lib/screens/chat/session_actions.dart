import 'package:broski/models/message.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/screens/diff_view_screen.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens the diff view screen for a single diff entry.
void openDiffView({
  required BuildContext context,
  required DiffEntry diff,
  String? messageId,
}) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => DiffViewScreen(diff: diff, messageId: messageId),
    ),
  );
}

/// Rewinds Claude Code files to the most recent checkpoint.
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
