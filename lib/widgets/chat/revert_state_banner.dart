import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

// Task 2: Revert state banner
class RevertStateBanner extends StatelessWidget {
  const RevertStateBanner({super.key, required this.onUndoRevert});
  final VoidCallback onUndoRevert;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.info.withValues(alpha: 0.15),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.info.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.history, color: theme.info, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Session reverted',
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          TextButton(
            onPressed: onUndoRevert,
            style: TextButton.styleFrom(
              foregroundColor: theme.info,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Undo Revert',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
