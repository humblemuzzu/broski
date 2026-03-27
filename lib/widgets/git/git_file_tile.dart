import 'package:flutter/material.dart';
import 'package:broski/theme/opencode_theme.dart';

import '../../models/git.dart';
import 'git_status_badge.dart';
import 'package:broski/theme/app_icons.dart';

class GitFileTile extends StatelessWidget {
  const GitFileTile({
    super.key,
    required this.change,
    required this.isStaged,
    required this.onToggleStage,
    required this.onViewDiff,
    this.onRevert,
  });
  final GitFileChange change;
  final bool isStaged;
  final VoidCallback onToggleStage;
  final VoidCallback onViewDiff;
  final VoidCallback? onRevert;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      title: Text(
        change.path,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
      subtitle: change.oldPath != null
          ? Text(
              'from ${change.oldPath}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11, color: ocTheme.textMuted),
            )
          : null,
      leading: GitStatusBadge(status: change.status),
      trailing: Wrap(
        spacing: 6,
        children: [
          IconButton(
            tooltip: 'View diff',
            onPressed: onViewDiff,
            icon: const Icon(AppIcons.preview, size: 20),
          ),
          if (onRevert != null && !isStaged)
            IconButton(
              tooltip: 'Revert file',
              onPressed: onRevert,
              icon: const Icon(AppIcons.restore, size: 20),
            ),
          TextButton(
            onPressed: onToggleStage,
            child: Text(isStaged ? 'Unstage' : 'Stage'),
          ),
        ],
      ),
    );
  }
}
