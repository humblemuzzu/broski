import 'package:broski/models/session_context.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_change_counts.dart';
import 'package:flutter/material.dart';

/// One file of the modified files section: its shortened path and its line
/// counts.
class SidebarModifiedFileItem extends StatelessWidget {
  const SidebarModifiedFileItem({super.key, required this.file});

  final ModifiedFile file;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Icon(AppIcons.description, size: 16, color: theme.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              file.shortPath,
              style: AppTypography.bodySmall(color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          SidebarChangeCounts(
            additions: file.additions,
            deletions: file.deletions,
          ),
        ],
      ),
    );
  }
}
