import 'package:flutter/material.dart';

import '../../widgets/chat/detail_sheet.dart';

class GitDiffInline extends StatelessWidget {
  const GitDiffInline({super.key, required this.title, required this.diff});

  final String title;
  final String diff;

  static Future<void> show({
    required BuildContext context,
    required String title,
    required String diff,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: title,
      initialSize: 0.75,
      maxSize: 0.95,
      child: GitDiffInline(title: title, diff: diff),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (diff.trim().isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Text('No diff output.'),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(
            context,
          ).colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
          borderRadius: BorderRadius.circular(12),
        ),
        child: SelectableText(
          diff,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 12.5,
            height: 1.45,
          ),
        ),
      ),
    );
  }
}
