import 'package:broski/models/git.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/git/git_diff_inline.dart';
import 'package:flutter/material.dart';

class GitLogSheet extends StatelessWidget {
  const GitLogSheet({
    super.key,
    required this.entries,
    required this.onLoadDiff,
  });

  final List<GitLogEntry> entries;
  final Future<String> Function(String hash) onLoadDiff;

  static Future<void> show({
    required BuildContext context,
    required List<GitLogEntry> entries,
    required Future<String> Function(String hash) onLoadDiff,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: 'Commit Log',
      initialSize: 0.75,
      child: GitLogSheet(entries: entries, onLoadDiff: onLoadDiff),
    );
  }

  String _formatTimestamp(DateTime timestamp) {
    final local = timestamp.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '${local.year}-$month-$day $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const Padding(
        padding: Insets.card,
        child: Text('No commits yet.'),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Column(
        children: entries.map((entry) {
          return ListTile(
            dense: true,
            leading: Text(entry.shortHash, style: AppTypography.codeSmall()),
            title: Text(
              entry.subject.isEmpty ? '(no subject)' : entry.subject,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Text(
              '${entry.author} • ${_formatTimestamp(entry.timestamp)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            onTap: () async {
              final diff = await onLoadDiff(entry.hash);
              if (!context.mounted) return;
              await GitDiffInline.show(
                context: context,
                title: 'Commit ${entry.shortHash}',
                diff: diff,
              );
            },
          );
        }).toList(),
      ),
    );
  }
}
