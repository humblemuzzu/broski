import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
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
        _Counts(
          additions: changed.additions,
          deletions: changed.deletions,
          key: const ValueKey('changed-files-total'),
        ),
        const SizedBox(height: Spacing.sm),
        for (final file in changed.files) _FileRow(file: file),
        if (changed.omitted > 0)
          Text('and ${changed.omitted} more', style: AppTypography.caption()),
      ],
    );
  }
}

class _FileRow extends StatelessWidget {
  const _FileRow({required this.file});

  final FileChange file;

  @override
  Widget build(BuildContext context) => Padding(
    key: ValueKey('changed-file:${file.path}'),
    padding: Insets.topSm,
    child: Row(
      children: [
        Expanded(child: Text(file.path, style: AppTypography.codeSmall())),
        _Counts(additions: file.additions, deletions: file.deletions),
      ],
    ),
  );
}

class _Counts extends StatelessWidget {
  const _Counts({super.key, this.additions, this.deletions});

  final int? additions;
  final int? deletions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Text.rich(
      TextSpan(
        children: [
          if (additions case final added?)
            TextSpan(
              text: '+$added',
              style: TextStyle(color: theme.success),
            ),
          if (additions != null && deletions != null) const TextSpan(text: ' '),
          if (deletions case final removed?)
            TextSpan(
              text: '−$removed',
              style: TextStyle(color: theme.error),
            ),
        ],
      ),
      style: AppTypography.codeSmall(),
    );
  }
}
