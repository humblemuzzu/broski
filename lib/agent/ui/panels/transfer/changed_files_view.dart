import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// The files a session changed: each once, with the lines added and removed
/// across all its edits, and the totals. A count the tool did not report is
/// not shown for that file.
class ChangedFilesView extends StatelessWidget {
  const ChangedFilesView({super.key, required this.changed});

  final ChangedFilesListed changed;

  @override
  Widget build(BuildContext context) {
    if (changed.files.isEmpty) {
      return const Text(
        'No file was changed in this session.',
        key: ValueKey('changed-files-none'),
      );
    }
    final count = changed.files.length + changed.omitted;
    return Column(
      key: const ValueKey('changed-files'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '$count ${count == 1 ? 'file' : 'files'} changed',
          style: AppTypography.labelLarge(),
        ),
        FileCounts(
          additions: changed.additions,
          deletions: changed.deletions,
          key: const ValueKey('changed-files-total'),
        ),
        const SizedBox(height: Spacing.sm),
        for (final file in changed.files)
          Padding(
            padding: Insets.topSm,
            child: FileChangeLine(
              key: ValueKey('changed-file:${file.path}'),
              change: file,
            ),
          ),
        if (changed.omitted > 0)
          Text('and ${changed.omitted} more', style: AppTypography.caption()),
      ],
    );
  }
}
