import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Bar shown above the input when Codex messages are queued for auto-send.
///
/// Supports multiple queued messages (unlike CCQueueBar which holds one).
/// Each message shows a preview with a cancel button. The first message in
/// the queue is the next to auto-send when the current turn completes.
class CxQueueBar extends StatelessWidget {
  const CxQueueBar({
    super.key,
    required this.queuedMessages,
    required this.onCancel,
    required this.onClearAll,
  });

  /// The list of queued message texts.
  final List<String> queuedMessages;

  /// Called when the user cancels a specific queued message by index.
  final void Function(int index) onCancel;

  /// Called when the user clears all queued messages.
  final VoidCallback onClearAll;

  @override
  Widget build(BuildContext context) {
    if (queuedMessages.isEmpty) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);
    final kPrimary = theme.primary;
    final kText = theme.text;
    final kMuted = theme.textMuted;
    final kSurface = theme.backgroundPanel;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: kSurface,
        border: Border(
          top: BorderSide(color: kPrimary.withValues(alpha: 0.3), width: 1),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              Icon(AppIcons.schedule, size: 14, color: kPrimary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  queuedMessages.length == 1
                      ? 'Queued — will send when turn completes'
                      : '${queuedMessages.length} queued — will send in order',
                  style: AppTypography.label(color: kMuted),
                ),
              ),
              if (queuedMessages.length > 1)
                GestureDetector(
                  onTap: onClearAll,
                  child: Text(
                    'Clear all',
                    style: AppTypography.label(color: kPrimary),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Spacing.xxs),
          // Message previews
          for (var i = 0; i < queuedMessages.length; i++)
            _QueuedMessageRow(
              index: i,
              message: queuedMessages[i],
              onCancel: () => onCancel(i),
              textColor: kText,
              mutedColor: kMuted,
            ),
        ],
      ),
    );
  }
}

class _QueuedMessageRow extends StatelessWidget {
  const _QueuedMessageRow({
    required this.index,
    required this.message,
    required this.onCancel,
    required this.textColor,
    required this.mutedColor,
  });

  final int index;
  final String message;
  final VoidCallback onCancel;
  final Color textColor;
  final Color mutedColor;

  @override
  Widget build(BuildContext context) {
    final preview = message.length > 80
        ? '${message.substring(0, 80)}…'
        : message;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: [
          Text(
            '${index + 1}.',
            style: TextStyle(color: mutedColor, fontSize: 11),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              preview,
              style: TextStyle(color: textColor, fontSize: 12),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          SizedBox(
            height: 24,
            width: 24,
            child: IconButton(
              onPressed: onCancel,
              icon: Icon(AppIcons.close, size: 14, color: mutedColor),
              padding: EdgeInsets.zero,
              tooltip: 'Cancel queued message',
            ),
          ),
        ],
      ),
    );
  }
}
