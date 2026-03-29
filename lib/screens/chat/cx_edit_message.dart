import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Handles the "Edit user message" action for Codex sessions.
///
/// Rolls back the thread to remove the selected turn, then prefills
/// the composer with the original message text so the user can edit
/// and re-send.
///
/// Extracted from chat_screen.dart per modular architecture rules.
Future<void> editCodexMessage({
  required BuildContext context,
  required WidgetRef ref,
  required String messageId,
  required String text,
  required TextEditingController controller,
  required FocusNode focusNode,
}) async {
  final chatState = ref.read(chatSessionProvider);
  final threadId = chatState.cxThreadId;
  if (threadId == null || threadId.isEmpty) return;

  try {
    // Roll back 1 turn (the user message + its assistant response).
    await ref
        .read(bridgeServiceProvider)
        .cxThreadRollback(threadId: threadId, numTurns: 1);

    // Prefill the composer with the original text for editing.
    controller.text = text;
    controller.selection = TextSelection.collapsed(offset: text.length);
    focusNode.requestFocus();
  } catch (e) {
    if (context.mounted) {
      showInfo(context, 'Edit failed: ${humanizeError(e)}');
    }
  }
}
