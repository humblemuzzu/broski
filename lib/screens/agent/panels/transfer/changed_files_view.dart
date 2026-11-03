import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/file_change_view.dart';
import 'package:broski/theme/app_icons.dart';
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
    final theme = OpenCodeTheme.of(context);
    if (changed.files.isEmpty) return _Nothing(theme: theme);
    final count = changed.files.length + changed.omitted;
    return Column(
      key: const ValueKey('changed-files'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Head(count: count, changed: changed, theme: theme),
        const SizedBox(height: 10),
        _FilePanel(files: changed.files, theme: theme),
        if (changed.omitted > 0)
          Padding(
            padding: Insets.topSm,
            child: Text(
              'and ${changed.omitted} more',
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}

class _Head extends StatelessWidget {
  const _Head({
    required this.count,
    required this.changed,
    required this.theme,
  });

  final int count;
  final ChangedFilesListed changed;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(AppIcons.edit, size: 14, color: theme.textMuted),
      const SizedBox(width: 6),
      Text(
        '$count ${count == 1 ? 'file' : 'files'} changed',
        style: AppTypography.labelLarge(color: theme.text),
      ),
      const Spacer(),
      FileCounts(
        additions: changed.additions,
        deletions: changed.deletions,
        key: const ValueKey('changed-files-total'),
      ),
    ],
  );
}

/// The changed files in one panel, each row under the one before it.
class _FilePanel extends StatelessWidget {
  const _FilePanel({required this.files, required this.theme});

  final List<FileChange> files;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: theme.backgroundPanel,
      borderRadius: Radii.brMd,
      border: Border.all(color: theme.borderSubtle),
    ),
    child: Column(
      children: [
        for (var at = 0; at < files.length; at++) ...[
          _FileRow(change: files[at], theme: theme),
          if (at < files.length - 1)
            Divider(height: 1, color: theme.borderSubtle),
        ],
      ],
    ),
  );
}

class _FileRow extends StatelessWidget {
  const _FileRow({required this.change, required this.theme});

  final FileChange change;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    child: Row(
      children: [
        Icon(AppIcons.description, size: 16, color: theme.textMuted),
        const SizedBox(width: 10),
        Expanded(
          child: FileChangeLine(
            key: ValueKey('changed-file:${change.path}'),
            change: change,
          ),
        ),
      ],
    ),
  );
}

class _Nothing extends StatelessWidget {
  const _Nothing({required this.theme});

  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.cardMd,
    decoration: BoxDecoration(
      color: theme.backgroundPanel,
      borderRadius: Radii.brMd,
      border: Border.all(color: theme.borderSubtle),
    ),
    child: Row(
      children: [
        Icon(AppIcons.checkCircle, size: 16, color: theme.success),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'No file was changed in this session.',
            key: const ValueKey('changed-files-none'),
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
        ),
      ],
    ),
  );
}
