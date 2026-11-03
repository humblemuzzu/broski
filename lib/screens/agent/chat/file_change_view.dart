import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart' show DiffEntry;
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/diff_viewer.dart' show DiffViewer;
import 'package:flutter/material.dart';

/// One changed file: the app's diff viewer when the backend sent a diff,
/// else its line.
class FileChangeView extends StatelessWidget {
  const FileChangeView({super.key, required this.change});

  final FileChange change;

  @override
  Widget build(BuildContext context) {
    final diff = change.diff;
    if (diff == null) return FileChangeLine(change: change);
    return DiffViewer(
      messageId: change.path,
      diff: DiffEntry(
        file: change.path,
        before: '',
        after: '',
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        diff: diff,
        status: change.change.wire,
      ),
    );
  }
}

/// A changed file in one line: the kind of change, the path (and the one it
/// had), and the lines added and removed, as far as the backend counted them.
class FileChangeLine extends StatelessWidget {
  const FileChangeLine({super.key, required this.change});

  final FileChange change;

  @override
  Widget build(BuildContext context) {
    final moved = change.previousPath == null
        ? ''
        : ' (was ${change.previousPath})';
    return Row(
      children: [
        Expanded(
          child: Text(
            '${change.change.wire} ${change.path}$moved',
            style: AppTypography.codeSmall(),
          ),
        ),
        FileCounts(additions: change.additions, deletions: change.deletions),
      ],
    );
  }
}

/// Lines added and removed; a count the backend did not report is not shown.
class FileCounts extends StatelessWidget {
  const FileCounts({super.key, this.additions, this.deletions});

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
