import 'package:broski/models/message.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_change_counts.dart';
import 'package:flutter/material.dart';

/// One file of the changes section: its shortened path and its line counts.
class SidebarDiffFileItem extends StatelessWidget {
  const SidebarDiffFileItem({super.key, required this.diff, this.onOpen});

  final DiffEntry diff;
  final void Function(DiffEntry diff)? onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onOpen == null ? null : () => onOpen!(diff),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(AppIcons.code, size: 16, color: theme.textMuted),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                _shortPath(diff.file),
                style: AppTypography.bodySmall(color: theme.text),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: Spacing.sm),
            SidebarChangeCounts(
              additions: diff.additions,
              deletions: diff.deletions,
            ),
          ],
        ),
      ),
    );
  }
}

String _shortPath(String path) {
  if (path.isEmpty) return 'file';
  final parts = path.split('/');
  if (parts.length <= 2) return path;
  final start = parts.length > 3 ? parts.length - 3 : 0;
  return parts.sublist(start).join('/');
}
