import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/opencode_theme.dart';

Widget? buildCcSystemMessageCard({
  required BuildContext context,
  required ChatMessage message,
  required String variant,
}) {
  final theme = OpenCodeTheme.of(context);

  if (variant == 'cc-local-command-output') {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Slash command output',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message.text,
            style: AppTypography.codeSmall(color: theme.text),
          ),
        ],
      ),
    );
  }

  if (variant == 'cc-elicitation-request') {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.warning.withValues(alpha: 0.25),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(AppIcons.link, size: 14, color: theme.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text,
              style: TextStyle(fontSize: 12, color: theme.textMuted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  if (variant == 'cc-elicitation-complete') {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.success.withValues(alpha: 0.25),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(AppIcons.checkCircle, size: 14, color: theme.success),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text,
              style: TextStyle(fontSize: 12, color: theme.textMuted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  if (variant.startsWith('cc-fast-mode:')) {
    final mode = variant.replaceFirst('cc-fast-mode:', '');
    final color = switch (mode) {
      'on' => theme.success,
      'cooldown' => theme.warning,
      _ => theme.textMuted,
    };

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25), width: 0.5),
      ),
      child: Row(
        children: [
          Icon(AppIcons.autoAwesome, size: 14, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Fast mode: $mode',
              style: TextStyle(fontSize: 12, color: theme.textMuted),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  return null;
}
