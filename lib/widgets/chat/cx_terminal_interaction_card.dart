import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Inline card shown when a Codex command execution is waiting for terminal
/// input (stdin). Displays an informational banner with an Abort button.
///
/// NOTE: Sending stdin to the agent requires a bridge-side handler
/// (`cx_send_stdin`) that doesn't exist yet. For now, we show the status
/// and let the user abort the hanging command.
class CxTerminalInteractionCard extends ConsumerWidget {
  const CxTerminalInteractionCard({super.key, this.itemId});

  /// The Codex item ID requesting terminal input.
  final String? itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.08),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.terminal, size: 16, color: theme.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Waiting for terminal input',
                  style: AppTypography.bodySmall(
                    color: theme.text,
                  ).copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  'The running command needs stdin input. '
                  'You can abort the current turn to unblock.',
                  style: AppTypography.label(color: theme.textMuted),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const _AbortButton(),
        ],
      ),
    );
  }
}

class _AbortButton extends ConsumerWidget {
  const _AbortButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: Radii.brXs,
        onTap: () {
          final state = ref.read(chatSessionProvider);
          final threadId = state.cxThreadId;
          if (threadId != null && threadId.isNotEmpty) {
            ref.read(bridgeServiceProvider).cxAbort(threadId: threadId);
          }
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: theme.error.withValues(alpha: 0.1),
            borderRadius: Radii.brXs,
            border: Border.all(color: theme.error.withValues(alpha: 0.3)),
          ),
          child: Text(
            'Abort',
            style: AppTypography.label(
              color: theme.error,
            ).copyWith(fontWeight: FontWeight.w600),
          ),
        ),
      ),
    );
  }
}
