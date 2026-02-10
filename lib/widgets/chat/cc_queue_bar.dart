
import 'package:flutter/material.dart';
import '../../theme/design_tokens.dart';
import 'package:broski/theme/app_icons.dart';
/// A bar shown above the main input when a Claude Code message is queued
/// for auto-send. Displays a preview of the pending message with a cancel button.
/// Inspired by CxSteerBar but for queued (not live) messages.
class CCQueueBar extends StatelessWidget {
  const CCQueueBar({
    super.key,
    required this.pendingMessage,
    required this.onCancel,
    required this.primaryColor,
    required this.textColor,
    required this.mutedColor,
    required this.surfaceColor,
  });
  /// The queued message text (preview shown to user).
  final String pendingMessage;
  /// Called when the user cancels the queued message.
  final VoidCallback onCancel;
  final Color primaryColor;
  final Color textColor;
  final Color mutedColor;
  final Color surfaceColor;
  @override
  Widget build(BuildContext context) {
    // Truncate preview for display
    final preview = pendingMessage.length > 80
        ? '${pendingMessage.substring(0, 80)}…'
        : pendingMessage;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: surfaceColor,
        border: Border(
          top: BorderSide(
            color: primaryColor.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            AppIcons.schedule,
            size: 14,
            color: primaryColor,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Queued — will send when turn completes',
                  style: TextStyle(
                    color: mutedColor,
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: Spacing.xxs),
                Text(
                  preview,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 12,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          SizedBox(width: Spacing.sm),
          SizedBox(
            height: 28,
            width: 28,
            child: IconButton(
              onPressed: onCancel,
              icon: Icon(
                AppIcons.close,
                size: 16,
                color: mutedColor,
              ),
              padding: EdgeInsets.zero,
              tooltip: 'Cancel queued message',
            ),
          ),
        ],
      ),
    );
  }
}
