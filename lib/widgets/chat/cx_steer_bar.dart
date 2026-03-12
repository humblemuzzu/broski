import 'package:flutter/material.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/opencode_theme.dart';

/// Shown above the input bar when Codex is streaming, indicating that
/// any new messages will steer/redirect the agent rather than queue.
class CxSteerBar extends StatelessWidget {
  const CxSteerBar({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.08),
        border: Border(
          top: BorderSide(color: theme.primary.withValues(alpha: 0.2)),
        ),
      ),
      child: Row(
        children: [
          Icon(AppIcons.bolt, size: 14, color: theme.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Agent is working · Messages will steer the agent',
              style: AppTypography.label(color: theme.primary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
