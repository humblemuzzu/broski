import 'package:broski/models/message.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// An inline widget shown when the AI SDK is retrying an API call.
///
/// Triggered by `'retry'` part type in `message.part.updated` event.
/// Displays the attempt number and optional error message.
///
/// Used in:
/// - `chat_screen.dart` message list (between messages or inside bubble)
/// - `message_bubble.dart` (as inline indicator)
///
/// Returns [SizedBox.shrink] when [retryInfo] is null.
class RetryIndicator extends StatelessWidget {
  const RetryIndicator({super.key, required this.retryInfo});

  final RetryInfo? retryInfo;

  @override
  Widget build(BuildContext context) {
    if (retryInfo == null) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final attempt = retryInfo!.attempt;
    final errorMessage = retryInfo!.errorMessage;

    return Container(
      margin: Insets.chipV,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.08),
        borderRadius: Radii.brSm,
        border: Border.all(
          color: theme.warning.withValues(alpha: 0.25),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: theme.warning,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Retrying… (attempt $attempt)',
                  style: TextStyle(
                    fontFamily: AppTypography.uiFontFamily,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: theme.warning,
                  ),
                ),
                if (errorMessage != null && errorMessage.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      errorMessage,
                      style: TextStyle(
                        fontFamily: AppTypography.uiFontFamily,
                        fontSize: 11,
                        color: theme.textMuted,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
