import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/rollback_sheet.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the Codex rollback sheet. Extracted from chat_screen.dart.
///
/// Returns early with a snackbar if there is no active Codex thread.
void showCodexRollbackSheet(BuildContext context, WidgetRef ref) {
  final theme = OpenCodeTheme.of(context);
  final chatState = ref.read(chatSessionProvider);
  final threadId = chatState.cxThreadId;
  if (threadId == null || threadId.isEmpty) {
    showSuccess(context, 'No Codex thread to rollback.');
    return;
  }
  final turns = chatState.messages
      .where((m) => m.role == MessageRole.user)
      .length;
  final maxTurns = turns <= 0 ? 1 : turns;
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) {
      return RollbackSheet(
        maxTurns: maxTurns,
        onRollback: (numTurns) async {
          final bridge = ref.read(bridgeServiceProvider);
          await bridge.cxThreadRollback(threadId: threadId, numTurns: numTurns);
          final items = await bridge.cxGetThreadMessages(threadId);
          ref.read(chatSessionProvider.notifier).hydrateCodexTranscript(items);
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Rolled back $numTurns turn${numTurns == 1 ? '' : 's'}',
                ),
                backgroundColor: theme.backgroundPanel,
              ),
            );
            Navigator.pop(context);
          }
        },
      );
    },
  );
}
