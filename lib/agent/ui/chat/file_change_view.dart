import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart' show DiffEntry;
import 'package:broski/theme/app_typography.dart';
import 'package:broski/widgets/diff_viewer.dart' show DiffViewer;
import 'package:flutter/material.dart';

/// One changed file: the app's diff viewer when the backend sent a diff,
/// else the path and the kind of change.
class FileChangeView extends StatelessWidget {
  const FileChangeView({super.key, required this.change});

  final FileChange change;

  @override
  Widget build(BuildContext context) {
    final diff = change.diff;
    if (diff == null) {
      final moved = change.previousPath == null
          ? ''
          : ' (was ${change.previousPath})';
      return Text(
        '${change.change.wire} ${change.path}$moved',
        style: AppTypography.codeSmall(),
      );
    }
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
